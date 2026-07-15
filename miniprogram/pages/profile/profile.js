// pages/profile/profile.js - 个人中心
const app = getApp()
const { generateQRPoster, fetchMiniProgramQRCode } = require('../../utils/qrcode.js')

Page({
  data: {
    userInfo: null,
    activated: false,
    cozeConnected: false,
    credits: { balance: 0, total_granted: 0, total_consumed: 0 },
    referrer: null,       // 上级推荐人
    membership: null,     // 会员状态
    referralStats: null,  // 分销统计
    loading: true,
    showPoster: false,    // 海报预览弹窗
    posterPath: '',       // 海报临时路径
    referralCode: '',     // 当前分销码
    generatingPoster: false,

    // 最近调用
    showLogs: false,
    recentLogs: [],
    logPage: 1,
    logPageSize: 20,
    logHasMore: false,
    logLoading: false
  },

  onShow() {
    if (!app.globalData.token) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadStatus()
  },

  async loadStatus() {
    try {
      const status = await app.request({ url: '/api/user/status' })
      const creditsData = status.credits || { balance: 0, totalGranted: 0, totalConsumed: 0 }
      this.setData({
        userInfo: app.globalData.userInfo,
        activated: status.activation?.isActive || false,
        cozeConnected: status.cozeConnected || false,
        credits: {
          balance: creditsData.balance ?? 0,
          totalGranted: creditsData.totalGranted ?? creditsData.total_granted ?? 0,
          totalConsumed: creditsData.totalConsumed ?? creditsData.total_consumed ?? 0,
        },
        referrer: status.referrer || null,
        membership: status.membership || null,
        loading: false
      })

      // 如果是会员，加载分销统计
      if (status.membership?.isMember) {
        this.loadReferralStats()
      }
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  // 加载分销统计
  async loadReferralStats() {
    try {
      const stats = await app.request({ url: '/api/referral/stats' })
      this.setData({ referralStats: stats })
    } catch (e) {
      // 静默失败
    }
  },

  // 获取分销链接
  async getReferralLink() {
    try {
      wx.showLoading({ title: '获取链接...' })
      const res = await app.request({ url: '/api/referral/link' })
      wx.hideLoading()

      if (res.isMember) {
        const link = res.referralUrl
        const code = res.referralCode
        this.setData({ referralCode: code })

        wx.showActionSheet({
          itemList: ['复制分享链接', '生成分享海报'],
          success: (actionRes) => {
            if (actionRes.tapIndex === 0) {
              // 复制链接
              wx.setClipboardData({
                data: link,
                success: () => wx.showToast({ title: '已复制分享链接', icon: 'success' })
              })
            } else if (actionRes.tapIndex === 1) {
              // 生成海报
              this.generatePoster(code)
            }
          }
        })
      } else {
        wx.showToast({ title: '您还不是会员，无法使用分享功能', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '获取失败', icon: 'none' })
    }
  },

  // 生成推广海报
  async generatePoster(referralCode) {
    if (this.data.generatingPoster) return
    this.setData({ generatingPoster: true })

    wx.showLoading({ title: '生成海报...' })

    try {
      // 获取页面 Canvas 节点
      const canvasNode = await new Promise((resolve, reject) => {
        const query = wx.createSelectorQuery()
        query.select('#posterCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (res && res[0] && res[0].node) {
              resolve(res[0].node)
            } else {
              reject(new Error('无法获取Canvas节点'))
            }
          })
      })

      // 优先获取微信小程序码（扫码直达小程序），失败降级为网页链接二维码
      let qrImagePath = null
      try {
        qrImagePath = await fetchMiniProgramQRCode(referralCode, app.globalData.apiBase, app.globalData.token)
      } catch (e) {
        qrImagePath = null
      }

      const userDisplay = app.globalData.userInfo?.phone || app.globalData.userInfo?.email || '用户'

      // 二维码内容始终为网页链接（H5 注册自动绑定分销）。
      // 若成功拿到微信小程序码图片，generateQRPoster 内部优先画小程序码（好友扫码直达小程序）；
      // 若小程序码图片加载失败，则降级为用此网页链接生成本地二维码。
      const qrText = `${app.globalData.apiBase}/login?ref=${referralCode}`

      const posterPath = await generateQRPoster(
        qrText,
        'AI工具平台',
        `${userDisplay} 邀请你加入`,
        canvasNode,
        { qrImagePath }
      )

      this.setData({
        posterPath,
        showPoster: true,
        generatingPoster: false
      })
      wx.hideLoading()
    } catch (e) {
      console.error('[profile] 生成海报失败:', e)
      wx.hideLoading()
      this.setData({ generatingPoster: false })
      wx.showToast({ title: e.message || '生成海报失败，请重试', icon: 'none' })
    }
  },

  // 关闭海报预览
  closePoster() {
    this.setData({ showPoster: false })
  },

  // 保存海报到相册
  savePoster() {
    const { posterPath } = this.data
    if (!posterPath) return

    wx.saveImageToPhotosAlbum({
      filePath: posterPath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许小程序保存图片到相册',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting()
              }
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  // 微信原生分享（点击右上角 ... 转发）
  onShareAppMessage() {
    const code = this.data.referralCode
    if (code) {
      return {
        title: `${app.globalData.userInfo?.phone || app.globalData.userInfo?.email || '好友'} 邀请你加入AI工具平台`,
        path: `/pages/login/login?ref=${code}`,
        imageUrl: this.data.posterPath || ''
      }
    }
    return {
      title: 'AI工具平台 - 智能AI工具集合',
      path: '/pages/index/index'
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    const code = this.data.referralCode
    if (code) {
      return {
        title: `${app.globalData.userInfo?.phone || app.globalData.userInfo?.email || '好友'} 邀请你加入AI工具平台`,
        query: `ref=${code}`,
        imageUrl: this.data.posterPath || ''
      }
    }
    return {
      title: 'AI工具平台 - 智能AI工具集合'
    }
  },

  // 连接Coze
  async connectCoze() {
    try {
      wx.showLoading({ title: '获取授权链接...' })
      const res = await app.request({
        url: '/api/coze/oauth/authorize?from=miniprogram',
        method: 'GET'
      })
      wx.hideLoading()
      if (res.authUrl) {
        // 使用 web-view 在小程序内完成 OAuth 授权
        wx.navigateTo({
          url: '/pages/oauth/oauth?authUrl=' + encodeURIComponent(res.authUrl)
        })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '获取授权链接失败', icon: 'none' })
    }
  },

  // 断开Coze
  async disconnectCoze() {
    wx.showModal({
      title: '确认断开',
      content: '断开后将无法使用AI工具，确定要断开吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await app.request({
              url: '/api/coze/oauth/disconnect',
              method: 'POST'
            })
            wx.showToast({ title: '已断开', icon: 'success' })
            this.loadStatus()
          } catch (e) {
            wx.showToast({ title: e.message || '断开失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 空操作（阻止事件冒泡）
  noop() {},

  // 最近调用 - 打开弹窗
  async showRecentLogs() {
    this.setData({ showLogs: true, logPage: 1, recentLogs: [], logHasMore: false })
    await this.loadRecentLogs()
  },

  // 加载调用日志
  async loadRecentLogs() {
    if (this.data.logLoading) return
    this.setData({ logLoading: true })
    try {
      const data = await app.request({
        url: `/api/audit-logs?page=${this.data.logPage}&pageSize=${this.data.logPageSize}`
      })
      const logs = (data.logs || []).map(log => ({
        ...log,
        created_at: log.created_at ? log.created_at.replace('T', ' ').substring(0, 19) : ''
      }))
      const newLogs = this.data.logPage === 1 ? logs : [...this.data.recentLogs, ...logs]
      this.setData({
        recentLogs: newLogs,
        logHasMore: logs.length >= this.data.logPageSize,
        logLoading: false
      })
    } catch (e) {
      this.setData({ logLoading: false })
    }
  },

  // 加载更多
  loadMoreLogs() {
    if (this.data.logLoading || !this.data.logHasMore) return
    this.setData({ logPage: this.data.logPage + 1 })
    this.loadRecentLogs()
  },

  // 关闭日志弹窗
  closeLogs() {
    this.setData({ showLogs: false })
  },

  // 去激活页
  goActivate() {
    wx.navigateTo({ url: '/pages/activate/activate' })
  },

  // 退出登录
  handleLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          wx.redirectTo({ url: '/pages/login/login' })
        }
      }
    })
  }
})
