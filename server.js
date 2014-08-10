var http              = require('http').Server(app);
var express           = require('express');
var app               = express();
var crypto            = require('crypto');
var server            = require('http').Server(app);
var io                = require('socket.io')(server);
var configuration     = require('./config/environment');
var allowCrossDomain  = require('./lib/cross-domain');

var randomBytes       = crypto.randomBytes(100);
var randSecret        = crypto.createHash('sha1').update(randomBytes).digest('hex');
var port              = configuration.app.port || 4000;

var spaces = ['Main'];
var friends = {};

app.configure(function(){
	app.use(allowCrossDomain);
	app.use(express.cookieParser());
	app.use(express.session({ secret: randSecret }));
	app.use(express.compress());
});

server.listen(port, function(){
	console.log('Facing Server Started in ' + process.env.NODE_ENV + ' mode on port ' + configuration.app.port);
});

io.sockets.on('connection', function(socket) {

	socket.on('addFriend', function(name) {
		socket.name = name;
		socket.space = 'Main';
		friends[name] = name;
		socket.join('Main');
		socket.emit('updateSpaces', spaces, 'Main');
	});

	socket.on('createSpace', function(space) {
		spaces.push(space);
		socket.emit('updateSpaces', spaces, socket.space);
		socket.broadcast.emit('updateSpaces', spaces, socket.space);
	});

	socket.on('sendData', function(data) {
		io.sockets["in"](socket.space).emit('receiveData', socket.name, data);
	});

	socket.on('switchSpace', function(newspace) {
		var oldspace = socket.space;
		socket.leave(socket.space);
		socket.join(newspace);
		socket.space = newspace;
		socket.emit('updateSpaces', spaces, newspace);
	});

	socket.on('disconnect', function() {
		var friend_name = socket.name;
		var space = socket.space;

		delete friends[socket.name];
		io.sockets.emit('updatefriends', friends);

		socket.leave(socket.space);
	});
});
