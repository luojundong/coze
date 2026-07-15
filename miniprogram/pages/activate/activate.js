// pages/activate/activate.js
const app = getApp()

Page({
  data: {
    code: '',
    loading: false,
    errorMsg: '',
    success: false,
    credits: 0,
    toolName: ''
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.trim().toUpperCase(), errorMsg: '' })
  },

  async handleActivate() {
    const { code } = this.data
    if (!code) {
      this.setData({ errorMsg: '请输入激活码' })
      return
    }

    this.setData({ loading: true, errorMsg: '' })

    // 如果有待绑定的分销推荐码，随激活请求一起发送（后端会在激活时创建分销关系）
    const pendingRef = app.globalData.pendingRef

    try {
      const requestData = { code }
      if (pendingRef) {
        requestData.referralCode = pendingRef
        console.log('[activate] 携带分销码发送激活请求:', pendingRef.substring(0, 12) + '...')
      }

      const res = await app.request({
        url: '/api/activate',
        method: 'POST',
        data: requestData
      })

      // 激活成功，清除待绑定的分销码
      if (pendingRef) {
        app.globalData.pendingRef = null
        console.log('[activate] 已随激活请求提交分销码:', pendingRef)
      }

      this.setData({
        success: true,
        credits: res.credits || 0,
        toolName: res.tool_name || '',
        loading: false
      })

      wx.showToast({ title: '激活成功', icon: 'success' })
    } catch (e) {
      // 如果激活失败但 pendingRef 仍然存在，login.js 可能在激活前已经绑定过
      // 如果 login.js 已成功绑定，就不需要重试了
      this.setData({
        errorMsg: e.message || '激活失败',
        loading: false
      })
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/tools/tools' })
  }
})
