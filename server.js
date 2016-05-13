var http = require("http"),
    drone = require("dronestream"),
	ws = require("ws");

var baseOrient = null;

var bebop = require('node-bebop');
var bbd = bebop.createClient();
var tcpVideoStream = bbd.getVideoStream();

bbd.connect(function() {
    console.log("Connected!");
    bbd.MediaStreaming.videoEnable(1);
    bbd.Camera.orientation(0, 0);
});

tcpVideoStream.on('error', function (err) {
    console.log('There was an error: %s', err.message);
    tcpVideoStream.end();
    tcpVideoStream.emit("end");
    init();
});

function angleDiff( a,  b) {
	var o = a - b;
	while ( o > 180 ) o -= 360;
	while ( o < -180 ) o += 360;

	return o;
}

var staticDir = 'static';
var staticCheck = new RegExp('^/' + staticDir, 'i');
var staticLocalDir = './static';

var server = http.createServer(function(req, res) {

    var path, read;
    if (staticCheck.test(req.url)) {
        path = staticLocalDir + req.url.replace(staticCheck, '');
        require("fs").createReadStream(path).pipe(res);
    } else {
        require("fs").createReadStream(__dirname + "/index.html").pipe(res);
    }
  });

/*
 var body = [];
 req.on('data', function(chunk) {
 body.push(chunk);
 }).on('end', function() {
 body = Buffer.concat(body).toString();
 //console.log("ACTION: ",JSON.parse(body));
 var e = JSON.parse(body);
 if(baseOrient === null) {
 baseOrient = {p: e.alpha, t: e.gamma};
 } else {
 var orient = {p: angleDiff(e.alpha,baseOrient.p), t: angleDiff(e.gamma,baseOrient.t)};
 //console.log("O: ",orient);
 try{
 bbd.Camera.orientation(-orient.t, -orient.p);
 } catch(e) {
 //console.log("OOB");
 }
 }

 });
 res.end();
 */

var controlStreamServer = new ws.Server({server: server, path: '/control'});

function handleOrientation(data) {
    if(baseOrient === null) {
        baseOrient = {p: data.alpha, t: data.gamma};
    } else {
        var orient = {p: angleDiff(data.alpha,baseOrient.p), t: angleDiff(data.gamma,baseOrient.t)};
        console.log("O: ",orient);
        try{
            bbd.Camera.orientation(-orient.t, -orient.p);
        } catch(e) {
            //console.log("OOB");
        }
    }
}

var pilotingAngles = {r: 0, p: 0, y: 0, g: 0};
var lastPilotingAngles = {};

var AXES = {leftHoriz: 0, leftVert: 1, rightHoriz: 2, rightVert: 3};
var AXES_CONTROL = {leftHoriz: 'y', leftVert: 'g', rightHoriz: 'r', rightVert: 'p'};
var AXES_FLIP = {leftHoriz: 1, leftVert: -1, rightHoriz: 1, rightVert: -1};
var AXES_MINIMUM_THRESHOLD = 0.15;
var AXES_SCALE_CEIL = 0.8;
var AXES_PRECISION_STEPS = 10;

var BUTTONS = {takeOff: 9, land: 8, stop: 16};
var BUTTONS_FUNCS = {takeOff: function(bbd) { bbd.takeOff(); }, land: function(bbd) { bbd.land(); }, stop: function(bbd) { bbd.stop(); }};
var buttonsPressed = {};

var DEADMAN_PERIOD = 500;
var lastCommandRecieved = 0;

function doDeadman() {
    var now = +(new Date());
    if (now - lastCommandRecieved > DEADMAN_PERIOD) {
        bbd.stop();

        // TODO: Return home??
        //console.log("DEADMAN SWITCH!!!");
    }
}

setInterval(doDeadman, 100);

function handleController(data) {
    for (var k in AXES) {
        if (AXES[k] in data.axes) {
            var val = data.axes[AXES[k]];
            if ( val < AXES_MINIMUM_THRESHOLD && val > -AXES_MINIMUM_THRESHOLD) {
                val = 0;
            } else if (val >= AXES_MINIMUM_THRESHOLD) {
                val = (val - AXES_MINIMUM_THRESHOLD) / (AXES_SCALE_CEIL - AXES_MINIMUM_THRESHOLD);
                if ( val > 1 ) {
                    val = 1;
                }

            } else if (val <= -AXES_MINIMUM_THRESHOLD) {
                val = (val + AXES_MINIMUM_THRESHOLD) / (AXES_SCALE_CEIL - AXES_MINIMUM_THRESHOLD);
                if ( val < -1) {
                    val = -1;
                }
            } else {
                // STOP!!!
                assert(false);
            }
            val *= AXES_FLIP[k];
            val *= AXES_PRECISION_STEPS;
            val = Math.floor(val);
            val /= AXES_PRECISION_STEPS;

            pilotingAngles[AXES_CONTROL[k]] = val * 100;
        }
    }

    var pilotFlag = pilotingAngles.r != 0 || pilotingAngles.p != 0;
    var shouldStop = (pilotingAngles.r == 0 && pilotingAngles.p == 0 && pilotingAngles.y == 0 && pilotingAngles.g == 0);

    var pilotingDirty = false;
    for ( var k in pilotingAngles ) {
        if (pilotingAngles[k] != lastPilotingAngles) {
            pilotingDirty = true;
        }
        lastPilotingAngles[k] = pilotingAngles[k]; // Copy the state
    }

    if (pilotingDirty) {
        if (shouldStop) {
            bbd.stop();
        } else {
            console.log(pilotFlag, pilotingAngles);
            bbd.Piloting.pcmd(pilotFlag ? 1 : 0, pilotingAngles.r, pilotingAngles.p, pilotingAngles.y, pilotingAngles.g);
        }
    }

    for ( var b in BUTTONS) {
        if (data.buttons[BUTTONS[b]] == 1) {
            if (buttonsPressed[b]) {
                continue;
            } else {
                buttonsPressed[b] = true;
            }
            console.log("BUTTON! "+b);
            BUTTONS_FUNCS[b](bbd);
        } else {
            buttonsPressed[b] = false;
        }
    }

    // No need for deadman yet.
    lastCommandRecieved = +(new Date());

    //console.log(data.buttons);

}

controlStreamServer.on('connection', function connection(conn) {
    console.log("Connection!");
    conn.on('message', function incoming(message) {
        var data = JSON.parse(message);
        if (data.type == 'orientation') {
            handleOrientation(data);
        } else if (data.type == 'controller') {
            handleController(data);
        }
    });
});

drone.listen(server, { ip: "192.168.42.1", tcpVideoStream: tcpVideoStream });
server.listen(5555);

exports.drone = bbd;