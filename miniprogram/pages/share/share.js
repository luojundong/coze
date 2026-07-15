// pages/share/share.js - 分享推广页
const app = getApp()
const { generateQRPoster, fetchMiniProgramQRCode } = require('../../utils/qrcode.js')

Page({
  data: {
    isMember: false,
    referralStats: null,
    linkCopied: false,
    showPoster: false,
    posterPath: '',
    referralCode: '',
    generatingPoster: false,
  },

  onLoad() {
    this.loadStatus()
  },

  async loadStatus() {
    try {
      const status = await app.request({ url: '/api/user/status' })
      const isMember = status.membership?.isMember || false
      this.setData({ isMember })

      if (isMember) {
        this.loadReferralStats()
      }
    } catch (e) {
      // ignore
    }
  },

  async loadReferralStats() {
    try {
      const stats = await app.request({ url: '/api/referral/stats' })
      this.setData({ referralStats: stats })
    } catch (e) {
      // 静默失败
    }
  },

  // 获取分享链接
  async getShareLink() {
    if (!this.data.isMember) {
      wx.showToast({ title: '请先升级会员', icon: 'none' })
      return
    }
    try {
      wx.showLoading({ title: '获取链接...' })
      const res = await app.request({ url: '/api/referral/link' })
      wx.hideLoading()

      if (res.referralUrl) {
        this.setData({ referralCode: res.referralCode })
        wx.setClipboardData({
          data: res.referralUrl,
          success: () => {
            this.setData({ linkCopied: true })
            wx.showToast({ title: '已复制分享链接', icon: 'success' })
            setTimeout(() => this.setData({ linkCopied: false }), 2000)
          }
        })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '获取失败', icon: 'none' })
    }
  },

  // 生成海报
  async generatePoster() {
    if (!this.data.isMember) {
      wx.showToast({ title: '请先升级会员', icon: 'none' })
      return
    }
    if (this.data.generatingPoster) return
    this.setData({ generatingPoster: true })

    // 先获取分销码
    let code = this.data.referralCode
    if (!code) {
      try {
        const res = await app.request({ url: '/api/referral/link' })
        code = res.referralCode
        this.setData({ referralCode: code })
      } catch (e) {
        this.setData({ generatingPoster: false })
        wx.showToast({ title: '获取失败', icon: 'none' })
        return
      }
    }

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
        qrImagePath = await fetchMiniProgramQRCode(code, app.globalData.apiBase, app.globalData.token)
      } catch (e) {
        qrImagePath = null
      }

      const userDisplay = app.globalData.userInfo?.phone || app.globalData.userInfo?.email || '用户'

      // 二维码内容始终为网页链接（H5 注册自动绑定分销）。
      // 若成功拿到微信小程序码图片，generateQRPoster 内部优先画小程序码（好友扫码直达小程序）；
      // 若小程序码图片加载失败，则降级为用此网页链接生成本地二维码。
      const qrText = `${app.globalData.apiBase}/login?ref=${code}`

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
      console.error('[share] 生成海报失败:', e)
      wx.hideLoading()
      this.setData({ generatingPoster: false })
      wx.showToast({ title: e.message || '生成海报失败', icon: 'none' })
    }
  },

  // 关闭海报
  closePoster() {
    this.setData({ showPoster: false })
  },

  // 保存海报
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
              if (res.confirm) wx.openSetting()
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  noop() {},
})
