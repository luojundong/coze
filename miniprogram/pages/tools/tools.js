// pages/tools/tools.js - AI工具列表
// v3: 常用工具收藏 + 使用教程
const app = getApp()

Page({
  data: {
    tools: [],
    filteredTools: [],
    favoriteTools: [],
    categories: [],
    selectedCategory: '',
    searchQuery: '',
    loading: true,
    credits: 0,
    cozeConnected: false
  },

  onShow() {
    if (!app.globalData.token) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadStatus()
    this.loadTools()
  },

  async loadStatus() {
    try {
      const status = await app.request({ url: '/api/user/status' })
      this.setData({
        credits: status.credits?.balance ?? 0,
        cozeConnected: status.cozeConnected || false
      })
    } catch (e) {
      console.error('加载状态失败:', e)
    }
  },

  async loadTools() {
    try {
      const params = []
      if (this.data.searchQuery) params.push(`search=${encodeURIComponent(this.data.searchQuery)}`)
      if (this.data.selectedCategory) params.push(`category=${encodeURIComponent(this.data.selectedCategory)}`)

      const url = `/api/tools${params.length > 0 ? '?' + params.join('&') : ''}`
      const data = await app.request({ url })
      const tools = (data.tools || []).map(tool => ({
        ...tool,
        activated: tool.is_activated ?? false,
        is_favorited: tool.is_favorited ?? false,
      }))

      const favoriteTools = tools.filter(t => t.is_favorited)

      this.setData({
        tools,
        filteredTools: tools,
        favoriteTools,
        categories: data.categories || [],
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      console.error('加载工具列表失败:', e)
    }
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
      // 刷新列表
      this.loadTools()
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({ searchQuery: e.detail.value })
    // 防抖 300ms
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this.loadTools()
    }, 300)
  },

  // 清除搜索
  clearSearch() {
    this.setData({ searchQuery: '' })
    this.loadTools()
  },

  // 选择分类
  onCategoryTap(e) {
    const category = e.currentTarget.dataset.category
    const newCategory = this.data.selectedCategory === category ? '' : category
    this.setData({ selectedCategory: newCategory })
    this.loadTools()
  },

  // 清除所有筛选
  clearFilters() {
    this.setData({
      searchQuery: '',
      selectedCategory: ''
    })
    this.loadTools()
  },

  async onPullDownRefresh() {
    await Promise.all([this.loadStatus(), this.loadTools()])
    wx.stopPullDownRefresh()
  },

  goToolDetail(e) {
    const { id, activated } = e.currentTarget.dataset
    if (activated === false || activated === 'false') {
      wx.navigateTo({ url: '/pages/activate/activate' })
      return
    }
    wx.navigateTo({ url: `/pages/tool-detail/tool-detail?id=${id}` })
  },

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
  }
})
