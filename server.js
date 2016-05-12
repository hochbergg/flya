var http = require("http"),
    drone = require("dronestream");

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

var server = http.createServer(function(req, res) {
	if (req.url.indexOf('action') != -1) {
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
	} else {
		require("fs").createReadStream(__dirname + "/index.html").pipe(res);
	}
  });

drone.listen(server, { ip: "192.168.42.1", tcpVideoStream: tcpVideoStream });
server.listen(5555);

exports.drone = bbd;