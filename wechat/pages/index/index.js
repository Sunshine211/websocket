const app = getApp()
let that  // 针对this引用
let socket_is_open = false  // 判断是否开启websocket
let chosed_id = ""  // 选中对在线用户id

Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    canIUse: wx.canIUse('button.open-type.getUserInfo'),
    msgs: [],  // 信息列表
    users: [],  // 在线用户列表
    scrollTop: 100,
    txt_val: "",  // 请输入信息框的值
  },

  onLoad: function () {
    that = this
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: app.globalData.userInfo,
        hasUserInfo: true
      })
    } else if (this.data.canIUse) {
      // 由于 getUserInfo 是网络请求，可能会在 Page.onLoad 之后才返回
      // 所以此处加入 callback 以防止这种情况
      app.userInfoReadyCallback = res => {
        this.setData({
          userInfo: res.userInfo,
          hasUserInfo: true
        })
      }
    } else {
      // 在没有 open-type=getUserInfo 版本的兼容处理
      wx.getUserInfo({
        success: res => {
          app.globalData.userInfo = res.userInfo
          this.setData({
            userInfo: res.userInfo,
            hasUserInfo: true
          })
        }
      })
    }
    that.runWebSocket()  // 加载websocket操作
  },

  runWebSocket: function () {
    that.wsConnect()  // 连接

    wx.onSocketOpen((res) => {  // 监听WebSocket连接打开事件
      console.log('WebSocket连接已打开！')
      socket_is_open = true
      setTimeout(() => {  // 自动改名操作
        let my_name = that.data.userInfo.nickName
        if (my_name) {
          wx.sendSocketMessage({ data: "#改名 " + my_name })
        }
      }, 2000)
    })

    function appendLog(type, nickname, msg) {  // 聊天室更新函数
      let item = {}
      let prefix
      if (type === 'notification') {
        prefix = "通知"  // blue
        item.style = 'notification'  // 用于设置样式
      } else if (type == 'nick_update') {
        prefix = "注意"  // green
        item.style = 'nick_update'
      } else if (type == 'reward') {
        prefix = "恭喜"  // red
        item.style = "reward_congradulation"
      } else {
        prefix = nickname  // black
        item.style = 'normal'
      }
      item.msg_txt = (prefix || msg) ? (prefix + "：" + msg) : ""  // 确定在聊天室显示什么
      let msgs = that.data.msgs  // data引用
      // 更新聊天室
      msgs.push(item)
      let scrollTop = that.data.scrollTop  // 自动滑动
      scrollTop += 30
      that.setData({
        msgs: msgs,
        scrollTop: scrollTop
      })
    }

    wx.onSocketMessage((res) => {  // 监听服务器的消息事件
      let data = JSON.parse(res.data);
      if (data.type == "refresh") {  // 在线用户更新操作：获取非本人用户的用户信息，并置顶本人信息
        let users = data.users
        users.unshift(that.data.users[0])
        that.setData({ users: users })
        return
      }
      appendLog(data.type, data.nickname, data.message);  // 聊天室内更新信息
      if (data.type == "notification" || data.type == "nick_update") {  // 更新在线用户列表的用户信息
        that.updateUsers(data)
      }
      console.log("ID: [%s] = %s", data.id, data.message);
    })

    wx.onSocketClose((res) => {
      appendLog("notification","","连接中断");
      console.log('WebSocket 已关闭！')
    })

    function disconnect() {  // 关闭链接操作，待使用
      wx.closeSocket()
    }
  },

  updateUsers: function (data) {  // 处理在线用户上下线、改昵称更新，以更新在线用户列表
    let users = that.data.users
    if (data.type == "notification") {
      let msg = data.message
      let substr = msg.substring(msg.length - 3)
      if (substr === '已连接') {  // 增加在线用户列表
        users.push({ id: data.id, nickname: data.nickname, style: "" })
      } else if (substr === '已下线') {  // 删除在线用户列表
        for (let i = 0; i < users.length; i++) {
          if (users.id == data.id) {
            users.splice(i, 1)
          }
        }
      }
    } else {  // 改昵称操作
      for (let i = 0; i < users.length; i++) {
        if (users[i].id == data.id) {
          users[i].nickname = data.nickname
        }
      }
    }
    that.setData({ users: users })
  },

  // 创建websocket连接
  wsConnect: function () {
    wx.connectSocket({
      // url: 'ws://192.168.14.179:8181',  // 请求的域名
      url: 'ws://172.0.0.1:8080',
      data: {
      },
      method: "POST",
      fail: () => {
        let item = {}
        let msgs = that.data.msgs  // data引用
        item.msg_txt = '连接失败，可能因为：1、域名未经认证；2、重复上线。---->打开右上调试窗口可以测试'
        item.style = 'fail'
        msgs.push(item)
        let scrollTop = that.data.scrollTop
        scrollTop += 30
        that.setData({
          msgs: msgs,
          scrollTop: scrollTop
        })
      }
    })
  },

  // 提交表单
  formSubmit: function (e) {
    let msg = e.detail.value.msg
    if (socket_is_open) {
      wx.sendSocketMessage({ data: msg })
      that.setData({ txt_val: "" })  // 清空输入框
    }
  },

  getUserInfo: function (e) {
    console.log(e)
    app.globalData.userInfo = e.detail.userInfo
    this.setData({
      userInfo: e.detail.userInfo,
      hasUserInfo: true
    })
  },

  chooseUser: function (e) {  // 选择在线用户，选中的用户样式改变，并记录选中用户id
    let i = e.target.dataset.index
    let users = that.data.users
    for (let j = 0; j < users.length; j++) {
      if (i === j) {
        users[j].style = "chosed"
        chosed_id = users[j].id
      } else {
        users[j].style = ""
      }
    }
    that.setData({ users: users })
  },

  rewardOne: function () {  // 打赏选中的在线用户，其他用户无法看见打赏提示信息
    let msg = that.data.userInfo.nickName + "打赏了您1元钱"
    let id = chosed_id
    if (id) {
      let data = JSON.stringify({ "msg": msg, "id": id });
      wx.sendSocketMessage({ data: data })
      wx.showToast({
        title: '打赏成功',
        icon: 'success',
        duration: 1000
      })
    }
  },

  refresh: function () {  // 刷新在线用户，针对新用户无法看见在他之前进入小程序的用户的情况
    let data = ""
    try {  // 发送指令信息
      let users = that.data.users
      data = JSON.stringify({
        "order": 'refresh',
        "id": users[0].id
      })
    } catch (e) {
      console.log(e)
      return
    }
    wx.sendSocketMessage({ data: data })
  }
})
