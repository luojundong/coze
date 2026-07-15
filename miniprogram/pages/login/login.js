// pages/login/login.js
const app = getApp()

Page({
  data: {
    account: '',
    password: '',
    loginMethod: 'phone', // 默认账号登录
    isRegister: false,
    loading: false,
    errorMsg: '',
    refCode: ''  // 分销推荐码（从分享链接带入）
  },

  onLoad(options) {
    // 确保 apiBase 已设置
    const apiBase = wx.getStorageSync('apiBase') || 'https://coze.mooibi.com'
    app.globalData.apiBase = apiBase

    // 接收分销推荐码
    this.captureRef(options)
  },

  // 页面重新显示时，检查是否有待处理的分销码（小程序已运行状态下扫码进入时不会重走 onLoad）
  onShow() {
    const pending = app.globalData.pendingRef
    if (pending && !this.data.refCode) {
      this.setData({ refCode: pending })
    }
  },

  // 从页面参数/app全局变量中提取分销推荐码
  captureRef(options) {
    if (options.ref) {
      console.log('[login] 从 options.ref 捕获分销码:', options.ref.substring(0, 12) + '...')
      this.setData({ refCode: options.ref })
      app.globalData.pendingRef = options.ref
    } else if (options.scene) {
      // 微信小程序码扫码进入（scene 即分销码，由分享海报的小程序码带入）
      const ref = decodeURIComponent(options.scene)
      console.log('[login] 从 options.scene 捕获分销码:', ref.substring(0, 12) + '...')
      this.setData({ refCode: ref })
      app.globalData.pendingRef = ref
    } else if (options.query && options.query.scene) {
      // 某些微信基础库版本将 scene 放在 options.query.scene 中
      const ref = decodeURIComponent(options.query.scene)
      console.log('[login] 从 options.query.scene 捕获分销码:', ref.substring(0, 12) + '...')
      this.setData({ refCode: ref })
      app.globalData.pendingRef = ref
    }
  },

  // 切换登录/注册
  toggleMode() {
    this.setData({ isRegister: !this.data.isRegister, errorMsg: '' })
  },

  // 切换到账号登录
  switchToPhone() {
    this.setData({ loginMethod: 'phone', account: '', errorMsg: '' })
  },

  // 切换到邮箱登录
  switchToEmail() {
    this.setData({ loginMethod: 'email', account: '', errorMsg: '' })
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  // 登录/注册
  async handleSubmit() {
    const { account, password, loginMethod, isRegister } = this.data
    const apiBase = app.globalData.apiBase || 'https://coze.mooibi.com'

    if (!account || !password) {
      this.setData({ errorMsg: loginMethod === 'phone' ? '请填写账号和密码' : '请填写邮箱和密码' })
      return
    }

    // 验证账号格式
    if (loginMethod === 'phone') {
      if (!/^1[3-9]\d{9}$/.test(account)) {
        this.setData({ errorMsg: '请输入正确的账号码' })
        return
      }
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
        this.setData({ errorMsg: '请输入正确的邮箱地址' })
        return
      }
    }

    if (password.length < 6) {
      this.setData({ errorMsg: '密码至少6位' })
      return
    }

    this.setData({ loading: true, errorMsg: '' })

    try {
      // 使用自定义认证 API（与 Web 端一致）
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: `${apiBase}${endpoint}`,
          method: 'POST',
          header: {
            'Content-Type': 'application/json'
          },
          data: { email: account, password },
          success(res) {
            resolve(res)
          },
          fail(err) {
            reject(err)
          }
        })
      })

      if (res.statusCode >= 200 && res.statusCode < 300 && res.data.token) {
        const token = res.data.token
        const user = res.data.user || {}

        app.setLogin(token, {
          id: user.id,
          email: user.email || account,
          phone: user.phone || null
        })

        // 如果有分销推荐码，绑定分销关系
        // 优先从 globalData 读取，兜底从页面 data.refCode 读取（防止 globalData 被意外清空）
        const pendingRef = app.globalData.pendingRef || this.data.refCode
        if (pendingRef && user.id) {
          console.log('[login] 准备绑定分销关系, pendingRef:', pendingRef.substring(0, 12) + '...', 'userId:', user.id.substring(0, 8) + '...')
          try {
            await app.request({
              url: '/api/referral/link',
              method: 'POST',
              data: { referralCode: pendingRef, newUserId: user.id }
            })
            // 绑定成功才清除，避免激活页无法再次尝试
            console.log('[login] 分销关系绑定成功')
            app.globalData.pendingRef = null
            this.setData({ refCode: '' })
          } catch (e) {
            // 绑定失败不阻塞注册，pendingRef 留在全局变量中，激活页可再次尝试
            console.warn('[login] 首次绑定分销关系失败（激活页会重试）:', e.message)
            // 不在这里清除 pendingRef！
          }
        } else {
          console.log('[login] 无分销码需要绑定, pendingRef:', pendingRef, 'userId:', !!user.id)
        }

        wx.showToast({ title: isRegister ? '注册成功' : '登录成功', icon: 'success' })

        // 检查激活状态
        setTimeout(async () => {
          try {
            const status = await app.request({ url: '/api/user/status' })
            if (status.activation?.isActive) {
              wx.switchTab({ url: '/pages/tools/tools' })
            } else {
              wx.redirectTo({ url: '/pages/activate/activate' })
            }
          } catch (e) {
            wx.redirectTo({ url: '/pages/activate/activate' })
          }
        }, 500)
      } else {
        const msg = res.data?.error || (isRegister ? '注册失败' : (loginMethod === 'phone' ? '账号或密码错误' : '邮箱或密码错误'))
        this.setData({ errorMsg: msg, loading: false })
      }
    } catch (e) {
      this.setData({ errorMsg: '网络错误，请检查服务器地址', loading: false })
    }
  }
})
