// pages/tutorial/tutorial.js - 使用教程列表
const app = getApp()
const { parseRichContent } = require('../../utils/content-parser')

Page({
  data: {
    tutorialTools: [],
    loading: true,
    showModal: false,
    currentToolName: '',
    tutorialBlocks: [],  // [{ type: 'text', text } | { type: 'link', text, url } | { type: 'br' }]
  },

  onLoad() {
    this.loadTutorials()
  },

  async loadTutorials() {
    try {
      const data = await app.request({ url: '/api/tools' })
      // 只显示已激活且有教程内容的工具
      const tools = (data.tools || [])
        .filter(t => t.is_activated && t.tutorial)
        .map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          type: t.type,
          tutorial: t.tutorial,
        }))
      this.setData({ tutorialTools: tools, loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  showTutorial(e) {
    const { name, tutorial } = e.currentTarget.dataset
    const blocks = parseRichContent(tutorial || '')
    this.setData({
      showModal: true,
      currentToolName: name,
      tutorialBlocks: blocks,
    })
  },

  closeTutorial() {
    this.setData({ showModal: false })
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

  parseLineToBlocks(line, links, blocks) {
    const regex = /【【LINK_(\d+)】】|(https?:\/\/[^\s，。\n\r]+)/gi
    let lastIdx = 0
    let match

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIdx) {
        const text = line.slice(lastIdx, match.index)
        if (text) blocks.push({ type: 'text', text })
      }

      if (match[1] !== undefined) {
        const link = links[parseInt(match[1])]
        if (link) blocks.push({ type: 'link', text: link.text, url: link.url })
      } else if (match[2]) {
        const url = match[2]
        blocks.push({ type: 'link', text: url, url })
      }

      lastIdx = match.index + match[0].length
    }

    if (lastIdx < line.length) {
      blocks.push({ type: 'text', text: line.slice(lastIdx) })
    }
  },

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
