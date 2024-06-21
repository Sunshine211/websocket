const http = require('http')
// const fs = require('fs')
const WebSocket = require('ws')
const WebSocketServer = WebSocket.Server
const server = new http.createServer();
/*{
	cert: fs.readFileSync('tgpu.online_nginx/tgpu.online_bundle.crt'),
	key: fs.readFileSync('tgpu.online_nginx/tgpu.online.key')
}*/
// const wss = new WebSocketServer({port: 8183})
const wss = new WebSocketServer({server})
const uuid = require('node-uuid')  // universally unique identifier


let clients = []

/**
If you were in the middle of a conversation and another person magically appeared in front of you and started talking, that would be odd. 
To alleviate this, you can add notification of connection or disconnection and send that back to all connected clients.
Your code has several instances where you’ve gone through the trouble of iterating over all connected clients, 
checking the readyState of the socket, and sending a similar JSON-encoded string with varying values. 
For good measure, you’ll extract this into a generic function, and call it from several places in your code instead:
*/
function wsSend(type, client_uuid, nickname, message) {  // 给所有用户发送信息
	for (let i = 0; i < clients.length; i++) {
		let clientSocket = clients[i].ws
		if (clientSocket.readyState === WebSocket.OPEN) {  // 该用户已连接
        	clientSocket.send(JSON.stringify({
	            "type": type,
	            "id": client_uuid,
	            "nickname": nickname,
	            "message": message
			}))
        }
	}
}

function wsSendOne(type, resceiver_id, nickname, message) {  // 对目标用户发送信息
	for (let i = 0; i < clients.length; i++) {
		let clientSocket = clients[i].ws; 
		if (clients[i].id == resceiver_id) {  //只给某id发送信息
			if (clientSocket.readyState === WebSocket.OPEN) {  // 该用户已连接
				if (type == "refresh") {  // 刷新的情况
					console.log('someone refreshes...')
					let arr = []
					for (let j = 0; j < clients.length; j++) {
						if (clients[j].id != resceiver_id) {  // 对于某用户，push所有非本人用户信息给他
							arr.push({ 
								id: clients[j].id, 
								nickname: clients[j].nickname,
								style: "" 
							})							
						}
					}
		        	clientSocket.send(JSON.stringify({
			            "type": type,
			            "users": arr,
			            "id": resceiver_id
					}))					
				} else {  // 奖励的情况
		        	clientSocket.send(JSON.stringify({
			            "type": type,
			            "id": resceiver_id,
			            "nickname": nickname,
			            "message": message
					}))					
				}

	        }			
		}

	}
}

let clientIndex = 1
wss.on('connection', (ws) => {  // 服务器监控各个ws连接
	/*
	Assigning the result of the uuid.v4 function to the client_uuid variable allows you to reference it later when identifying message sends and any close event. 
	A simple metadata object in the form of JSON contains the client UUID along with the WebSocket object.
	*/
	let client_uuid = uuid.v4()
	let nickname = "游客" + clientIndex
	clientIndex++
	clients.push({ "id": client_uuid, "ws": ws, "nickname": nickname });
	console.log('client [%s] connected', client_uuid);  // 服务器端显示client client_uiid连接

	let connect_message = nickname + " 已连接"
    wsSend("notification", client_uuid, nickname, connect_message)  // 给每一个connect发送新用户连接信息（JSON）

    /*
	When the server receives a message from the client, 
	it iterates over all known connected clients using the clients collection, 
	and send back a JSON object containing the message and id of the message sender. 
	You may notice that this also sends back the message to the client that initiated, 
	and this simplicity is by design. 
	On the frontend client you don’t update the list of messages unless it is returned by the server:
    */
    // 如果连接传来信息，则通知用户
	ws.on('message', (data) => { 
		let message = ""
		try {  // 这是新增加的功能：打赏和刷新，此时msg传来JSON
    		let obj = JSON.parse(data);
    		// 打赏的情况：传来{msg,id}
    		message = (obj.msg) ? obj.msg : ""
    		let resceiver_id = (obj.id) ? obj.id : ""
    		// 刷新的情况：传来{order,id}
    		let order = (obj.order) ? obj.order : ""
    		if (order == "refresh" && resceiver_id) {  // 刷新的情况
    			wsSendOne("refresh", resceiver_id, "", "")  // 给某用户刷新页面
    			return  // 结束后续操作
    		}
    		if (resceiver_id) {  //打赏的情况
    			wsSendOne("reward", resceiver_id, nickname, message)  // 给被打赏的人发送聊天信息
    			return	
    		}
		} catch(e) {
    		message = data  // 这是最初实现的聊天功能
		}
		// 以下信息都发送在信息栏
		if (message.indexOf('#改名') === 0) {  // 更新昵称操作
			let nickname_array = message.split(' ')
			if (nickname_array.length >= 2) {
				let old_nickname = nickname
				nickname = nickname_array[1]
				let nickname_message = "用户" + old_nickname + "昵称修改为：" + nickname
				for (let i = 0; i < clients.length; i++) {  // 服务器更新昵称
					if (clients[i].id == client_uuid) {
						clients[i].nickname = nickname
					}
				}
				wsSend("nick_update", client_uuid, nickname, nickname_message)  // 给每一个connect发送用户更改昵称信息（JSON）
			}
		} else {  // 发送聊天信息
          wsSend("message", client_uuid, nickname, message)  // 给每一个connect发送聊天信息（JSON）
        }			
	})

	// 以下是关闭连接的函数的创建与调用
	let closeSocket = function(customMessage) { 
		for (let i = 0; i < clients.length; i++) {
			if (clients[i].id == client_uuid) {  // 指向当前用户
				let disconnect_message = (customMessage) ? customMessage : nickname + " 已下线"
             	wsSend("notification", client_uuid, nickname, disconnect_message)  // 给所有用户报信息
              	clients.splice(i, 1)  // 删除该用户
            }
		} 
	}

	ws.on('close', () => { 
		console.log("on things"); 
		closeSocket()
	})

	process.on('SIGINT', () => {   // 服务器中端时客户端显示提示信息
		console.log("Closing things"); 
		closeSocket('服务器已中断连接'); 
		process.exit();
	})

});


server.listen(8080, () => {
    console.log('WebSocket server listening on port 8080');
});


/*
const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');

const server = new https.createServer({
  cert: fs.readFileSync('/path/to/cert.pem'),
  key: fs.readFileSync('/path/to/key.pem')
});
const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
  });

  ws.send('something');
});

server.listen(8080);
*/