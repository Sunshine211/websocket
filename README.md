# websocket-demo
微信小程序与nodejs实现聊天室与打赏

【1】在index.js中的wxConnect方法中请求的域名需要修改
【2】nodejs版本：v8.4.0
通过node server.js开启服务器
【3】微信开发者工具：v1.01.170907
测试使用的是本地IP，选择“不校验安全域名、TLS 版本以及 HTTPS 证书”，否则会报错
【4】真机环境测试
估计由于域名不合法的原因有时websocket请求失败，而打开调试窗口则能够成功
