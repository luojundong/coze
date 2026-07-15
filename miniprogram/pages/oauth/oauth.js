// pages/oauth/oauth.js - Coze OAuth 授权引导页
const app = getApp()

Page({
  data: {
    step: 'loading', // loading | copying | copied | waiting
    authUrl: ''
  },

  onLoad(options) {
    if (options.authUrl) {
      const authUrl = decodeURIComponent(options.authUrl)
      this.setData({ authUrl, step: 'copying' })
      // 自动复制授权链接到剪贴板
      wx.setClipboardData({
        data: authUrl,
        success: () => {
          this.setData({ step: 'copied' })
        },
        fail: () => {
          // 复制失败，显示手动操作
          this.setData({ step: 'waiting' })
        }
      })
    } else if (options.state === 'success') {
      // 授权成功回调（从外部浏览器回来）
      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]
      if (prevPage && prevPage.loadStatus) {
        prevPage.loadStatus()
      }
      wx.showToast({ title: 'Coze 连接成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1000)
    } else {
      wx.showToast({ title: '缺少授权链接', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  // 手动复制链接
  copyLink() {
    wx.setClipboardData({
      data: this.data.authUrl,
      success: () => {
        this.setData({ step: 'copied' })
        wx.showToast({ title: '已复制链接', icon: 'none' })
      }
    })
  },

  // 打开浏览器（尝试用内置浏览器，不支持则提示用户手动操作）
  openBrowser() {
    // 微信小程序无法直接打开外部浏览器
    // 只能提示用户用系统浏览器打开复制的链接
    this.copyLink()
  },

  // 用户已完成授权，返回并刷新状态
  goBackDone() {
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    if (prevPage && prevPage.loadStatus) {
      prevPage.loadStatus()
    }
    wx.navigateBack()
  }
})
