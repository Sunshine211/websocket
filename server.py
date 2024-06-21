import asyncio
import json
import random
import uuid
import websockets
from collections import deque
from loguru import logger
import pymysql

def get_questions():
    # 连接到MySQL数据库
    conn = pymysql.connect(
        host='tgpu.online',
        user='root',
        password='030110',
        database='weixin',
        charset='utf8mb4'
    )
    try:
        with conn.cursor() as cursor:
            # 执行SQL查询
            sql = "SELECT QuestionText, CorrectAnswer, OptionA, OptionB, OptionC, OptionD FROM question"
            cursor.execute(sql)

            # 获取所有记录
            results = cursor.fetchall()

            # 转换结果为指定格式的字典列表
            questions = [
                {
                    "QuestionText": result[0],
                    "CorrectAnswer": result[1],
                    "OptionA": result[2],
                    "OptionB": result[3],
                    "OptionC": result[4],
                    "OptionD": result[5]
                } for result in results
            ]
            return questions

    finally:
        conn.close()

# 调用函数
questions = get_questions()
games = {}
clients = []
match_queue = deque()

def create_game(game_id, player1_socket, player2_socket):
    games[game_id] = {
        "player1": {"id": player1_socket, "score": 0},
        "player2": {"id": player2_socket, "score": 0}
    }

# 安全地移除客户信息
async def safely_remove_client(client_info):
    try:
        clients.remove(client_info)
        print(f"Connection closed: {client_info['id']}, nickname: {client_info['nickname']}")
    except ValueError:
        print("Attempted to remove a client not in list.")

async def safely_remove_from_match_queue(client_info):
    # 首先检查客户信息是否在队列中
    if client_info in match_queue:
        match_queue.remove(client_info)
        print(f"Player removed from match queue: {client_info['id']}, nickname: {client_info['nickname']}")
    else:
        print(f"Player not found in match queue: {client_info['id']}, nickname: {client_info['nickname']}")

async def process_message(data, client_info):
    # 提取消息类型和内容
    message_type = data.get('type', '')
    content = data.get('content', '')
    logger.info(f"type:{message_type}\tcontent:{content}")
    # 处理不同类型的消息
    if message_type == 'login':
        # 处理登录逻辑      
        handle_login(data, client_info)
    elif message_type == 'chat':
        # 处理聊天消息
        await ws_send('chat', client_info['id'], client_info['nickname'], content)
    elif message_type == 'answer':
        print(client_info,data)
        # 处理答题逻辑
        if 'action' in data and data['action'] == 'joinQueue':
            await join_queue(client_info)  # 传递 client_info
        elif 'action' in data and data['action'] == 'Result':
            await process_answer(client_info, data)
        elif 'action' in data and data['action'] == 'finished':
            await ws_send_one("isFinnish", data['id'], client_info['nickname'], 'isFinnish') 
        elif 'action' in data and data['action'] == 'closed':
            await safely_remove_from_match_queue(client_info) 
            await process_closegame(data)
        else:
            print('okok')
    elif message_type == 'change_nickname':
        # 处理昵称更改
        old_nickname = client_info['nickname']
        client_info['nickname'] = content  # 更新昵称
        await ws_send('nick_update', client_info['id'], client_info['nickname'], f"用户{old_nickname}昵称修改为：{client_info['nickname']}")
    elif message_type == 'refresh':
        # 处理刷新或状态更新请求
        await refresh_client_view(client_info['id'])
    else:
        print(f"Unhandled message type: {message_type}")
        
def handle_login(data, client_info):
    # 从数据中提取昵称
    nickname = data.get('nickname', 'Guest')
    # 更新客户端信息中的昵称
    client_info['nickname'] = nickname
    print(f"User {client_info['id']} logged in as {nickname}")

async def process_closegame(data):
    gameid = data['gameid']

    if gameid in games:
        del games[gameid]  # 删除对应gameid的游戏数据
        print(f"Game with ID '{gameid}' has been closed and removed.")
    else:
        print(f"Game with ID '{gameid}' not found.")

async def match_players():
    while True:
        await asyncio.sleep(1)  # 用于减少 CPU 使用率
        if len(match_queue) >= 2:
            player1 = match_queue.popleft()
            player2 = match_queue.popleft()
            await start_game(player1, player2)
            break
            
async def join_queue(client_info):
    # 将玩家添加到匹配队列中
    match_queue.append(client_info)
    # 使用封装的 ws_send 函数发送消息
    await ws_send("queue_status", client_info['id'], client_info['nickname'], "You have been added to the match queue.")
    await match_players()
    print(f"Player {client_info['nickname']} joined the match queue.")

async def start_game(player1, player2):
    # 在这里初始化游戏逻辑
    # 创建一个唯一的游戏ID
    game_id = str(uuid.uuid4())
    # 初始化游戏状态并保存到全局游戏字典
    create_game(game_id,player1['id'],player2['id'])
    # 假设每个 player 对象中都有一个 'ws' WebSocket 连接对象
    await player1['ws'].send(json.dumps({
        "type": 'matchFound',
        'game': game_id,
        'opponent': {
            'nickname': player2['nickname'],
            'id': player2['id'],
            'score':0
        }
        }))
    await player2['ws'].send(json.dumps({
        "type": 'matchFound',
        'game': game_id,
        'opponent': {
            'nickname': player1['nickname'],
            'id': player1['id'],
            'score':0
        }
        }))
    selected_questions = random.sample(questions, 10)
    # 将问题列表序列化为JSON格式
    questions_json = json.dumps({
        "type": 'question',
        "question": selected_questions
        })

    # 发送问题列表给两位玩家
    await broadcast_message(questions_json)

    print(f"Game started between {player1['nickname']} and {player2['nickname']}")
    print("Questions sent to both players.")

async def process_answer(client_info, data):
    # data = json.loads(data)
    game_id = data.get('game_id')
    score = data.get('result')
    print(data)
    if game_id in games:
        game = games[game_id]
        player_id = client_info['id']  # 假设 client_info 包含 'id'

        if player_id in [game['player1']['id'], game['player2']['id']]:
            # 更新分数
            for key, info in game.items():
                if info['id'] == player_id:
                    game[key]['score'] = score
                    break
            opponent_id = game['player1']['id'] if player_id == game['player2']['id'] else game['player2']['id']
            # await send_message_to_client(opponent_id, json.dumps({"type": 'scoreUpdate',"id": opponent_id,"nickname": client_info['nickname'],"message": score}))
            await ws_send_one("scoreUpdate", opponent_id, client_info['nickname'], score)           
            print(f"Score updated for player {player_id} in game {game_id}: {score}")
        else:   
            print(f"Player {player_id} not found in game {game_id}")
    else:
        print(f"No game found with ID {game_id}")

async def refresh_client_view(client_id):
    """Refresh or update the client's view, e.g., send updated list of users or game state."""
    # Assuming a function to gather updated data
    cls = [dict(filter(lambda x: x[0] != 'ws' , i.items())) for i in clients]
    updated_data = {'clients': cls}
    await ws_send_one('refresh', client_id, '', json.dumps(updated_data))

# 优化发送消息的函数
async def ws_send(type, client_uuid, nickname, message):
    payload = json.dumps({
        "type": type,
        "id": client_uuid,
        "nickname": nickname,
        "message": message
    })
    await broadcast_message(payload)

async def ws_send_one(type, receiver_id, nickname, message):
    payload = json.dumps({
        "type": type,
        "id": receiver_id,
        "nickname": nickname,
        "message": message
    })
    await send_message_to_client(receiver_id, payload)

async def broadcast_message(payload):
    for client in clients:
        if client['ws'].open:  # 使用正确的属性检查
            await client['ws'].send(payload)

async def send_message_to_client(client_id, payload):
    client = next((x for x in clients if x['id'] == client_id), None)
    if client and client['ws'].open:
        await client['ws'].send(payload)

async def handle_client(websocket, path):
    client_uuid = str(uuid.uuid4())
    nickname = json.loads(await websocket.recv()).get("nickname")
    client_info = {'id': client_uuid, 'ws': websocket, 'nickname': nickname}
    clients.append(client_info)
    print(f"New connection: {client_uuid}, nickname: {nickname}")
    try:
        async for message in websocket:
            data = json.loads(message)
            await process_message(data,client_info)

    finally:
        await safely_remove_from_match_queue(client_info) 
        await safely_remove_client(client_info)  # Correctly remove the client


async def start_server():
    async with websockets.serve(handle_client, "127.0.0.1", 11443):
        print("WebSocket server listening on port 11443")
        await asyncio.Future()  # Run forever

asyncio.run(start_server())
