// pages/index/index.js - 首页 Dashboard
const app = getApp()
const { parseRichContent } = require('../../utils/content-parser')

Page({
  data: {
    // 用户状态
    userInfo: null,
    credits: { balance: 0, totalGranted: 0, totalConsumed: 0 },
    activated: false,
    cozeConnected: false,
    isFullAccess: false,

    // 公告
    announcements: [],

    // 工具列表（热门/推荐）
    hotTools: [],

    // 收藏工具
    favoriteTools: [],

    // 状态
    loading: true,
    refreshing: false,

    // 公告详情
    showAnnounceDetail: false,
    announceDetail: { title: '', content: '', time: '' },
    announceDetailBlocks: [],  // [{ type: 'text', text } | { type: 'link', text, url } | { type: 'image', url } | { type: 'video', url }]

    // 首页可配置按钮（文字/图标来自后台）
    homeButtons: {
      contact_teacher: { text: '联系老师', icon: '' },
      tutorial: { text: '使用教程', icon: '' },
      share: { text: '分享', icon: '' },
    },
  },

  onLoad() {
    this.checkAuth()
  },

  onShow() {
    if (app.globalData.token) {
      this.loadDashboard()
    } else {
      this.checkAuth()
    }
  },

  async checkAuth() {
    // 检查是否已设置 API 地址
    const apiBase = wx.getStorageSync('apiBase')
    if (apiBase) {
      app.globalData.apiBase = apiBase
    }

    if (!app.globalData.apiBase) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }

    if (app.globalData.token) {
      this.loadDashboard()
    } else {
      wx.redirectTo({ url: '/pages/login/login' })
    }
  },

  async loadDashboard() {
    try {
      const [status, toolsData, announcementsData] = await Promise.all([
        app.request({ url: '/api/user/status' }),
        app.request({ url: '/api/tools' }),
        app.request({ url: '/api/announcements' })
      ])

      const creditsData = status.credits || {}
      const tools = (toolsData.tools || []).map(t => ({
        ...t,
        is_favorited: t.is_favorited ?? false,
      }))
      const activatedTools = tools.filter(t => t.is_activated)
      const favoriteTools = activatedTools.filter(t => t.is_favorited)

      // 公告列表预处理：提取纯文本摘要（去除HTML标签）
      const announcements = (announcementsData.announcements || []).slice(0, 3).map(a => {
        const blocks = this.parseContentBlocks(a.content || '')
        const plainText = blocks
          .filter(b => b.type === 'text' || b.type === 'link')
          .map(b => b.text)
          .join(' ')
        return { ...a, plainContent: plainText }
      })

      this.setData({
        userInfo: app.globalData.userInfo,
        credits: {
          balance: creditsData.balance ?? 0,
          totalGranted: creditsData.totalGranted ?? creditsData.total_granted ?? 0,
          totalConsumed: creditsData.totalConsumed ?? creditsData.total_consumed ?? 0,
        },
        activated: status.activation?.isActive || false,
        cozeConnected: status.cozeConnected || false,
        isFullAccess: status.activation?.isFullAccess || false,
        announcements,
        hotTools: activatedTools.filter(t => !t.is_favorited).slice(0, 4),
        favoriteTools: favoriteTools.slice(0, 4),
        loading: false
      })

      // 加载首页可配置项（按钮文字/图标、联系老师/教程内容），失败不影响首页其他内容
      this.loadHomeConfig()
    } catch (e) {
      console.error('加载首页失败:', e)
      this.setData({ loading: false })
    }
  },

  // 加载首页可配置项
  async loadHomeConfig() {
    try {
      const cfg = await app.request({ url: '/api/mini/home-config' })
      this.setData({
        homeButtons: {
          contact_teacher: cfg.buttons?.contact_teacher || { text: '联系老师', icon: '' },
          tutorial: cfg.buttons?.tutorial || { text: '使用教程', icon: '' },
          share: cfg.buttons?.share || { text: '分享', icon: '' },
        }
      })
    } catch (e) {
      console.error('加载首页配置失败:', e)
    }
  },

  // 下拉刷新
  async onPullDownRefresh() {
    this.setData({ refreshing: true })
    await this.loadDashboard()
    this.setData({ refreshing: false })
    wx.stopPullDownRefresh()
  },

  // 跳转工具详情
  goToolDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tool-detail/tool-detail?id=${id}` })
  },

  // 跳转激活页
  goActivate() {
    wx.navigateTo({ url: '/pages/activate/activate' })
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
        wx.navigateTo({
          url: '/pages/oauth/oauth?authUrl=' + encodeURIComponent(res.authUrl)
        })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '获取授权链接失败', icon: 'none' })
    }
  },

  // 跳转工具列表
  goTools() {
    wx.switchTab({ url: '/pages/tools/tools' })
  },

  // 跳转我的
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // 收藏/取消收藏
  async toggleFavorite(e) {
    const { id, favorited } = e.currentTarget.dataset
    try {
      if (favorited) {
        await app.request({
          url: `/api/favorites?tool_id=${id}`,
          method: 'DELETE'
        })
      } else {
        await app.request({
          url: '/api/favorites',
          method: 'POST',
          data: { tool_id: id }
        })
      }
      wx.showToast({ title: favorited ? '已取消收藏' : '已收藏', icon: 'success' })
      // 刷新首页数据
      this.loadDashboard()
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 空操作
  noop() {},

  // 公告详情
  showAnnouncementDetail(e) {
    const { title, content, time } = e.currentTarget.dataset
    const blocks = parseRichContent(content || '')
    this.setData({
      showAnnounceDetail: true,
      announceDetail: { title, content, time },
      announceDetailBlocks: blocks
    })
  },

  closeAnnounceDetail() {
    this.setData({ showAnnounceDetail: false })
  },

  // 解析内容为可视化块（支持 HTML <a> 标签 + 纯文本 URL）
  parseContentBlocks(raw) {
    const blocks = []

    // Step 1: 先处理 HTML <a> 标签，替换为占位符
    const links = []
    const html = raw.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, url, text) => {
      const idx = links.length
      links.push({ url, text: text || url })
      return `【【LINK_${idx}】】`
    })

    // Step 2: 处理 <br> 和 \n 分段
    const lines = html.split(/<br\s*\/?>/i)
    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) blocks.push({ type: 'br' })
      const subLines = line.split('\n')
      subLines.forEach((sub, subIdx) => {
        if (subIdx > 0) blocks.push({ type: 'br' })
        if (!sub) return

        // Step 3: 在每段文本中识别占位符和纯文本 URL
        this.parseLineToBlocks(sub, links, blocks)
      })
    })

    return blocks
  },

  // 解析一行文本为 blocks
  parseLineToBlocks(line, links, blocks) {
    // 合并正则：先匹配占位符，再匹配纯文本 URL
    const regex = /【【LINK_(\d+)】】|(https?:\/\/[^\s，。\n\r]+)/gi
    let lastIdx = 0
    let match

    while ((match = regex.exec(line)) !== null) {
      // 前面的纯文本
      if (match.index > lastIdx) {
        const text = line.slice(lastIdx, match.index)
        if (text) blocks.push({ type: 'text', text })
      }

      if (match[1] !== undefined) {
        // HTML <a> 标签占位符
        const link = links[parseInt(match[1])]
        if (link) blocks.push({ type: 'link', text: link.text, url: link.url })
      } else if (match[2]) {
        // 纯文本 URL
        const url = match[2]
        blocks.push({ type: 'link', text: url, url })
      }

      lastIdx = match.index + match[0].length
    }

    // 剩余纯文本
    if (lastIdx < line.length) {
      blocks.push({ type: 'text', text: line.slice(lastIdx) })
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

  // 跳转联系老师内容页
  goContactTeacher() {
    wx.navigateTo({ url: '/pages/home-content/home-content?type=contact_teacher' })
  },

  // 跳转使用教程页（各工具自带的使用教程，不由后台编辑）
  goTutorial() {
    wx.navigateTo({ url: '/pages/tutorial/tutorial' })
  },

  // 跳转分享
  goShare() {
    wx.navigateTo({ url: '/pages/share/share' })
  }
})
