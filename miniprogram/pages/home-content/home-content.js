// pages/home-content/home-content.js - 通用内容展示页（联系老师 / 使用教程）
const app = getApp()
const { parseRichContent } = require('../../utils/content-parser')

Page({
  data: {
    title: '详情',
    blocks: [],
    loading: true,
  },

  onLoad(options) {
    const token = wx.getStorageSync('token')
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    app.globalData.apiBase = wx.getStorageSync('apiBase') || app.globalData.apiBase
    this.loadContent(options.type)
  },

  async loadContent(type) {
    try {
      const res = await app.request({ url: '/api/mini/home-config' })
      let title = '详情'
      let content = ''
      if (type === 'contact_teacher') {
        title = res.buttons?.contact_teacher?.text || '联系老师'
        content = res.contact_teacher_content || ''
      } else if (type === 'tutorial') {
        title = res.buttons?.tutorial?.text || '使用教程'
        content = res.tutorial_content || ''
      }
      const blocks = parseRichContent(content)
      this.setData({ title, blocks, loading: false })
      wx.setNavigationBarTitle({ title })
    } catch (e) {
      console.error('加载内容失败:', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 点击链接：复制到剪贴板
  openLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none', duration: 2500 })
      }
    })
  },

  noop() {},
})
