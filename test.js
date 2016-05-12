var bebop = require("node-bebop"),
    fs = require("fs");
    spawn = require('child_process').spawn;

//var output = fs.createWriteStream("./video.h264");

var    drone = bebop.createClient(),
    video = drone.getVideoStream();

//video.pipe(output);

console.log("Spawning...");
var mplayer = spawn('mplayer', ['-'], {stdio: ['pipe', 'ignore', 'ignore']}).on('error', function(error) {
	console.log("Spawn error" + error);
});

console.log("Piping...");
video.pipe(mplayer.stdin);

drone.connect(function() {
	console.log("Connected!");
  drone.MediaStreaming.videoEnable(1);
});
