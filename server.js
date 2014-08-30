var express = require('express'),
	app = express(),
	configuration = require('./config/environment'),
	allowCrossDomain = require('./lib/cross-domain'),
	server = require('http').createServer(app),
	io = require('socket.io').listen(server),
	uuid = require('node-uuid'),
	Room = require('./room.js'),
	_ = require('underscore')._;

app.configure(function()
{
	app.set('port', configuration.app.port || 4000);
	app.set('ipaddr', configuration.app.ipaddr || '127.0.0.1');
	app.use(allowCrossDomain);
	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(express.static(__dirname + '/public'));
	app.use('/components', express.static(__dirname + '/components'));
	app.use('/js', express.static(__dirname + '/js'));
	app.use('/icons', express.static(__dirname + '/icons'));
	app.set('views', __dirname + '/public');
	app.engine('html', require('ejs').renderFile);
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
	if(process.env.NODE_ENV == 'development')
	{
		res.render('dev.html');
	}
	else
	{
		res.render('invite.html');
	}

});

server.listen(app.get('port'), app.get('ipaddr'), function()
{
	console.log('Facing App Server Started in ' + process.env.NODE_ENV + ' mode on port ' + configuration.app.port);
});

io.set('log level', 1);

var people = {};
var rooms = {};
var sockets = [];
var chatHistory = {};

io.sockets.on('connection', function(socket)
{
	socket.on('joinserver', function(name, device, fn)
	{
		if(!name || name === '')
		{
			return false;
		}

		var exists = false;
		var ownerRoomID = inRoomID = null;

		_.find(people, function(key, value)
		{
			if(key.name.toLowerCase() === name.toLowerCase())
			{
				return exists = true;
			}
		});

		// provide unique username:
		if(exists)
		{
			var randomNumber = Math.floor(Math.random() * 1001)
			do{
				proposedName = name + randomNumber;
				_.find(people, function(key, value)
				{
					if(key.name.toLowerCase() === proposedName.toLowerCase())
					{
						return exists = true;
					}
				});
			}
			while(!exists);
			socket.emit('exists', {msg: 'The username already exists, please pick another one.', proposedName: proposedName});

			fn({
				success: false,
				message: 'You are already on the server.',
				name: name,
				device: device
			});
		}
		else
		{
			people[socket.id] = {'name': name, 'owns': ownerRoomID, 'inroom': inRoomID, 'device': device};
			socket.emit('update', 'You have connected to the server.');
			io.sockets.emit('update', people[socket.id].name + ' is online.')
			sizePeople = _.size(people);
			sizeRooms = _.size(rooms);
			io.sockets.emit('update-people', {people: people, count: sizePeople});
			socket.emit('roomList', {rooms: rooms, count: sizeRooms});

			// extra emit for GeoLocation
			socket.emit('joined');
			sockets.push(socket);

			fn({
				success: true,
				message: 'You have Joined the Server',
				name: name,
				device: device
			});
		}
	});

	socket.on('getOnlinePeople', function(fn)
	{
		fn({people: people});
	});

	socket.on('send', function(msg)
	{
		if(io.sockets.manager.roomClients[socket.id]['/' + socket.room] !== undefined)
		{
			io.sockets.in(socket.room).emit('receiveData', people[socket.id], msg);

			if(_.size(chatHistory[socket.room]) > 10)
			{
				chatHistory[socket.room].splice(0, 1);
			}
			else
			{
				chatHistory[socket.room].push(people[socket.id].name + ': ' + msg);
			}
		}
		else
		{
			socket.emit('update', 'Unable to Share Data');
		}
	});

	socket.on('disconnect', function()
	{
		// this handles the refresh of the name screen
		if(typeof people[socket.id] !== 'undefined')
		{
			purge(socket, 'disconnect');
		}
	});

	// Room functions
	socket.on('createRoom', function(name, fn)
	{
		if(typeof people[socket.id] === 'undefined')
		{
			fn({ success: false, message: 'Unable to Create Room' });

			return false;
		}


		if(people[socket.id].inroom)
		{
			socket.emit('update', 'You are in a room. Please leave it first to create your own.');

			fn({ success: false, message: 'You are in a room. Please leave it first to create your own.' });
		}
		else if(!people[socket.id].owns)
		{
			var id = name;
			var room = new Room(name, id, socket.id);

			rooms[id] = room;
			sizeRooms = _.size(rooms);
			io.sockets.emit('roomList', {rooms: rooms, count: sizeRooms});

			// add room to socket, and auto join the creator of the room
			socket.room = name;
			socket.join(socket.room);

			people[socket.id].owns = id;
			people[socket.id].inroom = id;
			people[socket.id].user_mode = 'host';

			room.addPerson(socket.id);

			socket.emit('update', 'Welcome to ' + room.name + '.');
			socket.emit('sendRoomID', { id: id });

			chatHistory[socket.room] = [];

			fn({ success: true, message: 'Welcome to ' + room.name });
		}
		else
		{
			socket.emit('update', 'You have already created a room.');

			fn({ success: false, message: 'You have already created a room.' });
		}
	});

	socket.on('check', function(name, fn)
	{
		var match = false;
		_.find(rooms, function(key, value)
		{
			if(key.name === name)
			{
				return match = true;
			}
		});
		fn({result: match});
	});

	socket.on('removeRoom', function(id)
	{
		var room = rooms[id];
		if(socket.id === room.owner)
		{
			purge(socket, 'removeRoom');
		}
		else
		{
			socket.emit('update', 'Only the owner can remove a room.');
		}
	});

	socket.on('joinRoom', function(id, user_id, user_mode, fn)
	{
		if(typeof people[socket.id] !== 'undefined')
		{
			var room = rooms[id];

			if(!room)
			{
				fn({ success: false, message: 'Invitation Code is no longer valid.' });

				return false;
			}

			if(typeof room.owner === 'undefined')
			{
				socket.emit('update', 'Invalid Attempt to Connect');
				fn({ success: false, message: 'Invalid Attempt to Connect' });

				return false;
			}

			// check if there are to many people in the private room
			if(room.private === true && room.people.length >= room.peopleLimit)
			{
				socket.emit('update', 'To Many People Connected');
				fn({ success: false, message: 'To Many People Connected' });

				console.log('To Many People Connected');

				console.log(room);

				return false;
			}

			if(socket.id === room.owner)
			{
				socket.emit('update', 'You are the owner of this room and you have already been joined.');
				fn({ success: false, message: 'You are the owner of this room and you have already been joined.' });
			}
			else
			{
				if(_.contains((room.people), socket.id))
				{
					socket.emit('update', 'You have already joined this room.');
					fn({ success: false, message: 'You have already joined this room.' });
				}
				else
				{
					if(people[socket.id].inroom !== null)
					{
						socket.emit('update', 'You are already in a room (' + rooms[people[socket.id].inroom].name + '), please leave it first to join another room.');
						fn({ success: false, message: 'You are already in a room (' + rooms[people[socket.id].inroom].name + '), please leave it first to join another room.' });
					}
					else
					{
						room.addPerson(socket.id);

						people[socket.id].inroom = id;
						people[socket.id].user_id = user_id;
						people[socket.id].user_mode = user_mode;

						socket.room = room.name;
						socket.join(socket.room);

						user = people[socket.id];

						io.sockets.in(socket.room).emit('update', user.name + ' has connected to ' + room.name + ' room.');
						io.sockets.in(socket.room).emit('joinedSpace', id, user_id, user_mode);
						socket.emit('update', 'Welcome to ' + room.name + '.');
						socket.emit('sendRoomID', {id: id});

						var keys = _.keys(chatHistory);

						if(_.contains(keys, socket.room))
						{
							socket.emit('history', chatHistory[socket.room]);
						}

						fn({ success: true, message: user.name + ' has connected to ' + room.name + ' room.' });
					}
				}
			}
		}
		else
		{
			socket.emit('update', 'Please enter a valid name first.');
			fn({ success: false, message: 'Please enter a valid name first.' });
		}
	});

	socket.on('leaveRoom', function(id)
	{
		var room = rooms[id];
		if(room)
		{
			purge(socket, 'leaveRoom');
		}
	});
});

function purge(s, action)
{
	/*
	 The action will determine how we deal with the room/user removal.

	 These are the following scenarios:

	 if the user is the owner and (s)he:

	 1) disconnects (i.e. leaves the whole server)
	 - advise users
	 - delete user from people object
	 - delete room from rooms object
	 - delete chat history
	 - remove all users from room that is owned by disconnecting user

	 2) removes the room
	 - same as above except except not removing user from the people object

	 3) leaves the room
	 - same as above

	 if the user is not an owner and (s)he's in a room:

	 1) disconnects
	 - delete user from people object
	 - remove user from room.people object

	 2) removes the room
	 - produce error message (only owners can remove rooms)

	 3) leaves the room
	 - same as point 1 except not removing user from the people object

	 if the user is not an owner and not in a room:

	 1) disconnects
	 - same as above except not removing user from room.people object

	 2) removes the room
	 - produce error message (only owners can remove rooms)

	 3) leaves the room
	 - n/a
	 */

	// user is in a room
	if(people[s.id].inroom)
	{
		// check which room user is in.
		var room = rooms[people[s.id].inroom];

		// user in room and owns room
		if(s.id === room.owner)
		{
			if(action === 'disconnect')
			{
				io.sockets.in(s.room).emit('update', 'The owner (' + people[s.id].name + ') has left the server. The room is removed and you have been disconnected from it as well.');
				var socketids = [];

				for(var i = 0; i < sockets.length; i++)
				{
					socketids.push(sockets[i].id);
					if(_.contains((socketids)), room.people)
					{
						sockets[i].leave(room.name);
					}
				}

				if(_.contains((room.people)), s.id)
				{
					for(var i = 0; i < room.people.length; i++)
					{
						people[room.people[i]].inroom = null;
					}
				}

				// remove people from the room:people{}collection
				room.people = _.without(room.people, s.id);

				// delete the room
				delete rooms[people[s.id].owns];

				// delete user from people collection
				delete people[s.id];

				// delete the chat history
				delete chatHistory[room.name];

				sizePeople = _.size(people);
				sizeRooms = _.size(rooms);

				io.sockets.emit('update-people', {people: people, count: sizePeople});
				io.sockets.emit('roomList', {rooms: rooms, count: sizeRooms});

				var o = _.findWhere(sockets, {'id': s.id});
				sockets = _.without(sockets, o);
			}
			// room owner removes room
			else if(action === 'removeRoom')
			{
				io.sockets.in(s.room).emit('update', 'The owner (' + people[s.id].name + ') has removed the room. The room is removed and you have been disconnected from it as well.');

				var socketids = [];
				for(var i = 0; i < sockets.length; i++)
				{
					socketids.push(sockets[i].id);
					if(_.contains((socketids)), room.people)
					{
						sockets[i].leave(room.name);
					}
				}

				if(_.contains((room.people)), s.id)
				{
					for(var i = 0; i < room.people.length; i++)
					{
						people[room.people[i]].inroom = null;
					}
				}

				delete rooms[people[s.id].owns];

				people[s.id].owns = null;

				// remove people from the room:people{}collection
				room.people = _.without(room.people, s.id);

				// delete the chat history
				delete chatHistory[room.name];

				sizeRooms = _.size(rooms);
				io.sockets.emit('roomList', {rooms: rooms, count: sizeRooms});
			}
			// room owner leaves room
			else if(action === 'leaveRoom')
			{
				io.sockets.in(s.room).emit('update', 'The owner (' + people[s.id].name + ') has left the room. The room is removed and you have been disconnected from it as well.');
				var socketids = [];
				for(var i = 0; i < sockets.length; i++)
				{
					socketids.push(sockets[i].id);
					if(_.contains((socketids)), room.people)
					{
						sockets[i].leave(room.name);
					}
				}

				if(_.contains((room.people)), s.id)
				{
					for(var i = 0; i < room.people.length; i++)
					{
						people[room.people[i]].inroom = null;
					}
				}
				delete rooms[people[s.id].owns];

				people[s.id].owns = null;

				// remove people from the room:people{}collection
				room.people = _.without(room.people, s.id);

				// delete the chat history
				delete chatHistory[room.name];

				sizeRooms = _.size(rooms);
				io.sockets.emit('roomList', {rooms: rooms, count: sizeRooms});
			}
		}
		// user in room but does not own room
		else
		{
			if(action === 'disconnect')
			{
				io.sockets.emit('update', people[s.id].name + ' has disconnected from the server.');
				if(_.contains((room.people), s.id))
				{
					var personIndex = room.people.indexOf(s.id);
					room.people.splice(personIndex, 1);
					s.leave(room.name);
				}

				delete people[s.id];

				sizePeople = _.size(people);
				io.sockets.emit('update-people', {people: people, count: sizePeople});

				var o = _.findWhere(sockets, {'id': s.id});
				sockets = _.without(sockets, o);
			}
			else if(action === 'removeRoom')
			{
				s.emit('update', 'Only the owner can remove a room.');
			}
			else if(action === 'leaveRoom')
			{
				if(_.contains((room.people), s.id))
				{
					var personIndex = room.people.indexOf(s.id);
					room.people.splice(personIndex, 1);
					people[s.id].inroom = null;
					io.sockets.emit('update', people[s.id].name + ' has left the room.');
					s.leave(room.name);
				}
			}
		}
	}
	else
	{
		// The user isn't in a room, but maybe he just disconnected, handle the scenario:
		if(action === 'disconnect')
		{
			io.sockets.emit('update', people[s.id].name + ' has disconnected from the server.');
			delete people[s.id];
			sizePeople = _.size(people);
			io.sockets.emit('update-people', {people: people, count: sizePeople});
			var o = _.findWhere(sockets, {'id': s.id});
			sockets = _.without(sockets, o);
		}
	}
}
