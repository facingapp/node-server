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

/* Configure Server */
app.configure(function(){
	app.use(allowCrossDomain);
	app.use(express.cookieParser());
	app.use(express.session({ secret: randSecret }));
	app.use(express.compress());
});

/* Start Listening */
server.listen(port, function(){
	console.log('Facing Server Started in ' + process.env.NODE_ENV + ' mode on port ' + configuration.app.port);
});

/* Add ability to use regex for params */
app.param(function(name, fn){
	if (fn instanceof RegExp)
	{
		return function(req, res, next, val){
			var captures;
			if (captures = fn.exec(String(val)))
			{
				req.params[name] = captures;
				next();
			}
			else
			{
				next('route');
			}
		}
	}
});

/* Create ID parameter */
app.param('id', /^[0-9a-zA-Z]+$/);

/* Check if this is an invite and try to launch app */
app.get('/invite/:id', function(req, res){
	res.sendfile('public/invite.html');
});

/* Listen for incomming messages */
io.sockets.on('connection', function(socket){

	/* Create Private Space for Friends */
	socket.on('createSpace', function(space){
		spaces.push(space);
		socket.emit('updateSpaces', spaces, socket.space);
		socket.broadcast.emit('updateSpaces', spaces, socket.space);
	});

	/* Add Person to initial Holding Space */
	socket.on('addFriend', function(name){
		socket.name = name;
		socket.space = 'Main';
		friends[name] = name;
		socket.join('Main');
		socket.emit('updateSpaces', spaces, 'Main');
	});

	/* Switch Person to Private Space */
	socket.on('switchSpace', function(newspace){
		var oldspace = socket.space;
		socket.leave(socket.space);
		socket.join(newspace);
		socket.space = newspace;
		socket.emit('updateSpaces', spaces, newspace);

		// @todo: make sure there are a max of two people in a space
	});

	/* Broadcast Users Data into Private Space */
	socket.on('sendData', function(data){
		io.sockets["in"](socket.space).emit('receiveData', socket.name, data);
	});

	/* Disconnect Person from Space */
	socket.on('disconnect', function(){
		delete friends[socket.name];
		io.sockets.emit('updatefriends', friends);

		socket.leave(socket.space);
	});
});
