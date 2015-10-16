var static = require('node-static');
var http = require('http');
var file = new(static.Server)();
var app = http.createServer(function (req, res) {
  if (req.method === 'POST' || req.method === 'post') {
    var paramStr = '';
    req.url = req.url.split('?')[0];
    req.on('data', function(data) {
      paramStr += data
    });
    req.on('end', function() {
      var params = getParameters(paramStr);
      var url = req.url;
      url = url + '?stb_id=' + params.room + '&user_id=' + params.user;
      req.url = url;
      req.method = 'GET';
      file.serve(req, res);
    });
  } else {
    file.serve(req, res);
  }
}).listen(3001);

function getParameters(params) {
  var query_string = {};
  var vars = params.split("&");

  for (var i=0; i<vars.length; i++) {
    var pair = vars[i].split('=');
    if(typeof query_string[pair[0]] === "undefined") {
      query_string[pair[0]] = pair[1];
    } else if(typeof query_string[pair[0]] === "string") {
      var arr = [query_string[pair[0]], pair[1]];
      query_string[pair[0]] = arr;
    } else {
      query_string[pair[0]].push(pair[1]);
    }
  }
  return query_string;
};

//var uuid = require('node-uuid');
var io = require('socket.io').listen(app);
var LIMIT = 30;

function User(name, socket) {
  this.name = name;
  this.socket = socket;
}

function Room(name, limit) {
  this.name = name;
  this.owner = null;
  this.users = [];
  this.userLimit = limit || LIMIT;
  this.userCount = 0;
}
Room.prototype = {
  init : function() {
  },
  joinRoom : function(user) {
    var u = this.findUser(user.name);
    if (u == null) {
      this.users.push(user);
      this.userCount++;
    } else {
      u.name = user.name;
      u.socket = user.socket;
    }
  },
  findUser : function(name) {
    var ul = this.users.filter(function (e) {
      return e.name === name;
    });

    return (ul.length > 0) ? ul[0] : null;
  },
  findUserBySocket : function(socket) {
    var ul = this.users.filter(function (e) {
      return e.socket.id === socket.id;
    });

    return (ul.length > 0) ? ul[0] : null;
  },
  leaveRoom : function(name) {
    var self = this;
    this.users.forEach(function(e,i,v){
      if (e.name === name) {
        delete self.users[i];
        self.users.splice(i,1);
        self.userCount--;
        return;
      }
    });
  },
  leaveRoomBySocket : function(socket) {
    var self = this;
    this.users.forEach(function(e,i,v){
      if (e.socket.id === socket.id) {
        delete self.users[i];
        self.users.splice(i,1);
        self.userCount--;
        return;
      }
    });
  },
  leaveAll : function() {
    var self = this;
    this.users.forEach(function(e,i,v){
      e.socket.leave(self.name, function(){});
      delete self.users[i];
    });
    this.users = [];
    this.userCount = 0;
  }
};


function RoomManager() {
  this.rooms = [];
} 
RoomManager.prototype = {
  init: function() {
  },
  openRoom: function(name, limit) {
    var r = this.rooms.filter(function(e) {
      return e.name === name;
    });
    if (r.length == 0) {
      r = new Room(name, limit);
      this.rooms.push(r);
    } else {
      return r[0];
    }
    return r;
  },
  findRoom: function(name) {
    var r = this.rooms.filter(function(e) {
      return e.name === name;
    });
    return (r.length == 0) ? null : r[0];
  },
  closeRoom: function(name) {
    var self = this;
    this.rooms.forEach(function(e,i,v) {
      if (e.name == name) {
        e.leaveAll();
        delete self.rooms[i];
        self.rooms.splice(i,1);
        return;
      }
    });
  },
  addUser: function(socket, roomName, userName, isOwner) {
    var r = this.findRoom(roomName);
    if (r) {
      var u = new User(userName, socket);
      r.joinRoom(u);
      isOwner && (r.owner = userName);
    } else {
      console.log("not found Room (" + roomName + ")");
      return false;
    }
    return true;
  },
  removeUser: function(socket) {
    var r = this.findRoom(socket.room);
    if (r) {
      r.leaveRoomBySocket(socket);
    }
  }
};

var rm = new RoomManager();

io.sockets.on('connection', function (socket){

  // 로그 서버와 클라이언트로 메세지를 전송하는 편의 함수
  function log(){
    var array = ['>>> Message from server: '];
    for (var i = 0; i < arguments.length; i++) {
      array.push(arguments[i]);
    }
      socket.emit('log', array);
  }

  socket.on('message', function (message) {
    log('Got message:', message);
    //socket.broadcast.to(message.room).emit('message', message);  // other sockets
    //io.sockets.in(message.room).emit('message', message);  // all sockets
    var r = rm.findRoom(message.room);
    var u = r && r.findUser(message.to);
    if (u) {
      //u.socket.emit(message);
      socket.broadcast.to(message.room).emit('message', message);
    }
  });

  socket.on('create', function (room, limit, user) {
    var client = io.of('/').adapter['rooms'][room];

    log('Request to create room ' + room);
    socket.room = room;
    if (!client){
      rm.openRoom(room, limit);
      rm.addUser(socket, room, user, true);
      socket.join(room);
      socket.emit('created', room, user);
    } else {
      socket.emit('fail', '(' + room + ') is already exist.');
    }
  });

  socket.on('join', function (room, user) {
    var numClients = 0;
    var client = io.of('/').adapter['rooms'][room];

    var r = rm.findRoom(room);

    if (!r) {
      socket.emit('fail', 'not found room(' + room + ')');
      return;
    } 

    if (io.sockets.clients) {
      numClients = io.sockets.clients(room).length;
    }
    socket.room = room;
    if (r.userCount < r.userLimit) {
      rm.addUser(socket, room, user);
      socket.join(room);
      socket.broadcast.to(room).emit('join', room, user, numClients);
      socket.emit('joined', room, r.owner);
    } else { // max two clients
      socket.emit('full', room);
    }
  });

  socket.on('disconnect', function () {
    var r = rm.findRoom(socket.room);
    var ro = r && r.owner;
    var so = r && r.findUserBySocket(socket);
    if (so && ro === so.name) {
      rm.closeRoom(socket.room);
    } else {
      rm.removeUser(socket);
    }
    socket.leave(socket.room, function() {
    console.log('This room is closed! : ' + socket.id);
   });
  });

});

