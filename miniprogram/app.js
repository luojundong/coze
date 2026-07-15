// app.js - 小程序入口
App({
  globalData: {
    apiBase: 'https://coze.mooibi.com',
    token: '',
    userInfo: null
  },

  onLaunch(options) {
    // 从本地存储恢复登录状态，优先使用已保存的地址
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const apiBase = wx.getStorageSync('apiBase') || 'https://coze.mooibi.com'
    this.globalData.apiBase = apiBase
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo
    }
    // 冷启动时若通过分享码（小程序码/链接）进入，捕获分销推荐码
    this.captureReferral(options)
  },

  onShow(options) {
    // 小程序在后台被扫码唤醒时，只有 onShow 能拿到 scene，必须在此捕获，
    // 否则页面的 onLoad 不会再次执行，分销码会丢失导致无法绑定分销关系。
    this.captureReferral(options)
  },

  // 从启动/唤醒参数中提取分销推荐码（scene 或 ref），写入 globalData.pendingRef
  captureReferral(options) {
    if (!options) return
    let ref = null
    if (options.ref) {
      ref = options.ref
    } else if (options.query && options.query.ref) {
      ref = options.query.ref
    } else if (options.scene) {
      // getwxacodeunlimit 生成的二维码，scene 即分销码（部分版本放在 options.scene）
      try {
        ref = decodeURIComponent(options.scene)
      } catch (e) {
        ref = options.scene
      }
    } else if (options.query && options.query.scene) {
      // 某些微信基础库版本将 scene 放在 options.query.scene 中
      try {
        ref = decodeURIComponent(options.query.scene)
      } catch (e) {
        ref = options.query.scene
      }
    }
    if (ref) {
      console.log('[app] 捕获到分销推荐码:', ref.substring(0, 12) + '...')
      this.globalData.pendingRef = ref
    }
  },

  // 封装请求方法
  request(options) {
    const apiBase = this.globalData.apiBase
    const token = this.globalData.token

    return new Promise((resolve, reject) => {
      const header = {
        'Content-Type': 'application/json',
        ...options.header
      }
      if (token) {
        header['x-session'] = token
      }

      wx.request({
        url: `${apiBase}${options.url}`,
        method: options.method || 'GET',
        data: options.data || {},
        header,
        timeout: options.timeout || 120000,  // 默认 120 秒，Bot 类型需要轮询等待
        success(res) {
          if (res.statusCode === 401) {
            // 登录过期，跳转登录页
            getApp().logout()
            wx.redirectTo({ url: '/pages/login/login' })
            reject(new Error('请先登录'))
            return
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            // 将 API 返回的错误字段附加到 Error 对象上，方便调用方判断
            const err = new Error(res.data?.error || `请求失败 (${res.statusCode})`)
            if (res.data?.needActivation) err.needActivation = true
            if (res.data?.needCozeAuth) err.needCozeAuth = true
            reject(err)
          }
        },
        fail(err) {
          reject(new Error(err.errMsg || err.message || '网络连接失败，请检查网络后重试'))
        }
      })
    })
  },

  // 登录
  setLogin(token, userInfo) {
    this.globalData.token = token
    this.globalData.userInfo = userInfo
    wx.setStorageSync('token', token)
    wx.setStorageSync('userInfo', userInfo)
  },

  // 登出
  logout() {
    this.globalData.token = ''
    this.globalData.userInfo = null
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
  }
})
