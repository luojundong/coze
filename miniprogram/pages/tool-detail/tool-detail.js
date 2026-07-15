// pages/tool-detail/tool-detail.js - AI工具使用页
// 混合架构：优先 SSE 流式（enableChunked） → 降级异步轮询
// v2: 修复 SSE 结束后内容消失 bug（currentTaskId 互斥 + 定时器完整清理）
// v3: 支持图片链接/普通链接解析渲染 + 图片预览
const app = getApp()

/**
 * 解析消息内容，将 Markdown 图片语法、裸图片URL、普通URL 转换为结构化元素
 * 返回数组 [{ type: 'text'|'image'|'link', content, url? }]
 */
function parseContent(content) {
  if (!content) return []

  const elements = []

  const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g
  // 允许 ] 与 ( 之间有可选空白或换行，避免 AI 输出把 Markdown 链接拆行导致无法解析
  const mdLinkRe = /\[([^\]]+)\]\s*\(([^)]+)\)/g
  const bareUrlRe = /(?<!["'(])(https?:\/\/[^\s<>"')\]]+)/gi

  // 图片 URL 判断
  const imageExtRe = /\.(png|jpe?g|gif|webp|bmp|svg|ico)(\?.*)?$/i
  // 非图片文件扩展名（视频、音频、文档等），即使 URL 路径匹配图片模式也应排除
  const nonImageExtRe = /\.(mp4|avi|mov|mkv|wmv|flv|webm|m4v|mp3|wav|ogg|aac|flac|pdf|docx?|xlsx?|pptx?|zip|rar|7z)(\?.*)?$/i
  const imageUrlPatterns = [
    /\/\/p9-.*\.byteimg\.com\//,
    /\/\/.*\.coze\.(cn|com)\/.*\/image/i,
    /\/\/.*\.volccdn\.com\//,
    /\/\/.*\/tos-.*\//,
    /\/api\/.*\/image/i,
  ]
  function isImageUrl(url) {
    // 明确的图片扩展名 → 是图片
    if (imageExtRe.test(url)) return true
    // 非图片扩展名（视频/音频/文档）→ 不是图片
    if (nonImageExtRe.test(url)) return false
    // URL 路径模式匹配 → 是图片
    return imageUrlPatterns.some(function (re) { return re.test(url) })
  }

  const placeholders = {}
  let placeholderIndex = 0
  let processed = content

  // Step 1: Markdown 图片
  processed = processed.replace(mdImageRe, function (_match, alt, url) {
    const key = '__IMG_' + (placeholderIndex++) + '__'
    placeholders[key] = { type: 'image', alt: alt, url: url }
    return key
  })

  // Step 2: Markdown 链接
  processed = processed.replace(mdLinkRe, function (_match, text, url) {
    const key = '__LINK_' + (placeholderIndex++) + '__'
    const isImage = isImageUrl(url)
    placeholders[key] = { type: isImage ? 'image' : 'link', alt: text, url: url }
    return key
  })

  // Step 3: 裸 URL
  processed = processed.replace(bareUrlRe, function (url) {
    const key = '__URL_' + (placeholderIndex++) + '__'
    const isImage = isImageUrl(url)
    placeholders[key] = { type: isImage ? 'image' : 'link', alt: url, url: url }
    return key
  })

  // Step 4: 按占位符分割
  const placeholderRe = /__((?:IMG|LINK|URL)_\d+)__/g
  let lastIndex = 0
  let match

  while ((match = placeholderRe.exec(processed)) !== null) {
    if (match.index > lastIndex) {
      const text = processed.slice(lastIndex, match.index)
      if (text) elements.push({ type: 'text', content: text })
    }
    const placeholder = placeholders[match[0]]
    if (placeholder) {
      elements.push({
        type: placeholder.type,
        content: placeholder.alt,
        url: placeholder.url,
      })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < processed.length) {
    elements.push({ type: 'text', content: processed.slice(lastIndex) })
  }

  if (elements.length === 0) {
    elements.push({ type: 'text', content: content })
  }

  return elements
}

/**
 * 为消息对象添加 parsed 字段
 * 使用 _parsedContent 追踪已解析的内容，避免重复解析
 * 无论 isStreaming 状态、无论 content 是否为空，都保证 parsed 字段存在
 */
function enrichMessage(msg) {
  // 内容未变化 → 直接返回缓存
  if (msg.parsed && msg._parsedContent === msg.content) return msg
  return Object.assign({}, msg, {
    parsed: parseContent(msg.content),
    _parsedContent: msg.content
  })
}

/**
 * 处理消息列表，为所有消息添加 parsed 字段
 */
function processMessages(messages) {
  return messages.map(function (msg) {
    return enrichMessage(msg)
  })
}

/**
 * 提取 workflow 工具的可读输出
 * 处理后端返回的 { output: string } 或嵌套 JSON，把 URL 原样返回供 parseContent 渲染成链接卡片
 */
function extractWorkflowOutput(res) {
  if (!res) return ''

  let output = ''
  if (typeof res === 'string') {
    output = res
  } else if (typeof res.output === 'string') {
    output = res.output
  } else if (res.output !== undefined && res.output !== null) {
    output = JSON.stringify(res.output)
  } else {
    output = JSON.stringify(res, null, 2)
  }

  output = output.trim()

  // 如果 output 本身是 JSON 字符串，尝试提取常见的 URL / 内容字段
  if ((output.startsWith('{') && output.endsWith('}')) || (output.startsWith('[') && output.endsWith(']'))) {
    try {
      const parsed = JSON.parse(output)
      if (parsed && typeof parsed === 'object') {
        const candidate =
          (typeof parsed.url === 'string' && parsed.url) ||
          (typeof parsed.link === 'string' && parsed.link) ||
          (typeof parsed.file_url === 'string' && parsed.file_url) ||
          (typeof parsed.image_url === 'string' && parsed.image_url) ||
          (typeof parsed.output === 'string' && parsed.output) ||
          (typeof parsed.content === 'string' && parsed.content)
        if (candidate) return candidate
      }
    } catch (e) {
      // 不是有效 JSON，保持原样
    }
  }

  return output
}

Page({
  data: {
    tool: null,
    loading: true,
    running: false,
    inputValue: '',
    messages: [],
    cozeConnected: false,
    botAvailable: true,
    toolActivated: true,
    conversationId: '',
    errorMsg: '',
    scrollTop: 0,
    scrollIntoViewId: '',
    // 激活相关（和 web 端一致，内嵌激活面板）
    activationCode: '',
    activating: false,
    activationError: '',
    activationSuccess: false,
    // 参数表单相关
    paramValues: {},        // 动态参数值 { name: value }
    // 流式/轮询控制
    currentTaskId: '',      // 当前生效任务 ID（防止旧任务污染新页面）
    streamTask: null,       // wx.request task 引用
    pollTimer: null,        // 降级轮询定时器
    noDataTimer: null,      // SSE 无数据监控定时器
    runningGuardTimer: null,// running 状态守护定时器：防止异常导致 running 永远为 true
    // 使用教程
    showTutorialModal: false,
    tutorialContent: [],
  },

  /**
   * 更新消息列表
   */
  _updateMessages(newMessages) {
    this._setData({ messages: newMessages })
  },

  /**
   * 带消息自动解析的 setData
   * 如果 data 中包含 messages 字段，自动调用 processMessages
   * 自动滚动到底部
   */
  _setData(data) {
    if (data.messages !== undefined) {
      data.messages = processMessages(data.messages)
      // 自动滚动到底部：同时使用 scrollTop 和 scroll-into-view 双保险
      data.scrollTop = 99999
      // 如果有消息，滚动到最后一条消息
      if (data.messages.length > 0) {
        const lastMsg = data.messages[data.messages.length - 1]
        data.scrollIntoViewId = 'msg-' + lastMsg.id
      }
    }

    // 对话结束时自动保存历史：running 从 true → false 且有消息内容时触发
    // 注意：在 setData 之前检查，因为 setData 是异步的
    const shouldSaveHistory = data.running === false && this.data.running === true && data.messages && data.messages.length > 0
    // conversationId 变化时持久化
    const convIdChanged = data.conversationId && data.conversationId !== this.data.conversationId

    // 使用 this.setData 代替 Page.prototype.setData.call，避免 prototype 引用丢失
    this.setData(data)

    if (shouldSaveHistory) {
      this._saveChatHistory()
    }
    if (convIdChanged) {
      this._saveConversationId(data.conversationId)
    }
  },

  onLoad(options) {
    this._toolId = options.id || ''
    this._isFirstLoad = true  // 标记首次加载，防止 onShow 重复触发
    if (options.id) {
      this.loadTool(options.id)
    }
  },

  onShow() {
    // 首次加载时 onShow 会在 onLoad 之后触发，此时由 onLoad 负责初始化，不做重复操作
    if (this._isFirstLoad) {
      this._isFirstLoad = false
      return
    }

    // 每次显示时重新加载工具详情，确保 Coze 连接状态和 prompt_info 是最新的
    // 注意：不重新加载消息列表，保留用户当前的对话上下文
    if (this._toolId && !this.data.loading) {
      this.refreshToolInfo()
    }

    // 修复 stuck running：如果 running=true 但没有任何活跃定时器/连接，强制释放
    if (this.data.running && !this.data.noDataTimer && !this.data.pollTimer && !this.data.streamTask && !this.data.runningGuardTimer) {
      console.warn('[onShow] Detected stuck running state, force release')
      const messages = this.data.messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m)
      this._setData({ messages, running: false, currentTaskId: '' })
    }

    // 额外兜底：如果最后一个助手消息已经有内容但仍在流式状态，可能是 SSE 结束事件丢失
    const messages = this.data.messages || []
    const lastAssistant = messages.slice().reverse().find(m => m.role === 'assistant')
    if (this.data.running && lastAssistant && lastAssistant.content && lastAssistant.isStreaming) {
      console.warn('[onShow] Assistant message has content but still streaming, force release')
      this._setData({
        messages: messages.map(m => m.id === lastAssistant.id ? { ...m, isStreaming: false } : m),
        running: false,
        currentTaskId: ''
      })
    }
  },

  onUnload() {
    // 先保存当前对话历史，避免运行中退出或页面被回收时丢失上下文
    this._saveChatHistory()
    this.cleanupTimers()
  },

  onHide() {
    // 小程序切后台：不中断流式连接，保持 SSE 继续接收
    // 注意：iOS 切后台可能断连，回到前台时 noDataTimer 会检测到并降级
  },

  /**
   * 完整清理所有定时器、连接（确保互斥，不留残留）
   */
  cleanupTimers() {
    const data = this.data

    // 1. 清理无数据监控定时器
    if (data.noDataTimer) {
      clearInterval(data.noDataTimer)
    }

    // 2. 清理降级轮询定时器
    if (data.pollTimer) {
      clearInterval(data.pollTimer)
    }

    // 3. 清理 running 守护定时器
    if (data.runningGuardTimer) {
      clearTimeout(data.runningGuardTimer)
    }

    // 4. 中断流式连接
    if (data.streamTask) {
      try { data.streamTask.abort() } catch (e) { /* ignore */ }
    }

    // 5. 一次性清除所有引用
    this._setData({
      noDataTimer: null,
      pollTimer: null,
      streamTask: null,
      runningGuardTimer: null,
    })
  },

  /**
   * 从本地存储加载工具的对话历史
   * @param {string} toolId - 工具 ID
   * @param {object} tool - 工具信息
   * @returns {Array} 消息列表
   */
  _loadChatHistory(toolId) {
    try {
      const key = `chat_history_${toolId}`
      const raw = wx.getStorageSync(key)
      if (!raw) return []
      const messages = JSON.parse(raw)
      if (!Array.isArray(messages)) return []
      // 过滤掉 isStreaming 状态（上次可能异常退出导致残留）
      return messages.map(m => ({ ...m, isStreaming: false }))
    } catch (e) {
      console.warn('[tool-detail] Failed to load chat history:', e)
      return []
    }
  },

  /**
   * 保存对话历史到本地存储
   * 最多保存 50 条消息，超出则保留最新的 50 条
   */
  _saveChatHistory() {
    if (!this._toolId) return
    try {
      const messages = this.data.messages || []
      // 过滤掉系统开场白（每次都会重新生成）
      const history = messages.filter(m => m.role !== 'system')
      // 最多保存 50 条
      const trimmed = history.length > 50 ? history.slice(-50) : history
      const key = `chat_history_${this._toolId}`
      wx.setStorageSync(key, JSON.stringify(trimmed))
    } catch (e) {
      console.warn('[tool-detail] Failed to save chat history:', e)
    }
  },

  /**
   * 加载 conversationId（本地存储）
   */
  _loadConversationId(toolId) {
    try {
      return wx.getStorageSync(`conv_id_${toolId}`) || ''
    } catch (e) {
      return ''
    }
  },

  /**
   * 保存 conversationId（本地存储）
   */
  _saveConversationId(conversationId) {
    if (!this._toolId || !conversationId) return
    try {
      wx.setStorageSync(`conv_id_${this._toolId}`, conversationId)
    } catch (e) {
      console.warn('[tool-detail] Failed to save conversationId:', e)
    }
  },

  /**
   * 用户主动停止生成
   * 中断所有流式连接和定时器，保留已接收的内容
   */
  stopGeneration() {
    if (!this.data.running) return
    console.log('[StopGeneration] User requested stop')

    // 保存已接收的内容
    const messages = this.data.messages.map(m => {
      if (m.isStreaming) {
        return { ...m, isStreaming: false }
      }
      return m
    })

    // 清理所有定时器和连接
    this.cleanupTimers()

    // 释放 running 状态（_setData 会自动保存对话历史）
    this._setData({
      messages,
      running: false,
      currentTaskId: ''
    })

    wx.showToast({ title: '已停止', icon: 'none', duration: 1000 })
  },

  /**
   * 清除对话历史
   * 清空消息列表和本地存储的聊天记录
   */
  clearChatHistory() {
    wx.showModal({
      title: '清除对话',
      content: '确定要清除当前对话记录吗？此操作不可撤销。',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        // 清除本地存储
        try {
          wx.removeStorageSync(`chat_history_${this._toolId}`)
          wx.removeStorageSync(`conv_id_${this._toolId}`)
        } catch (e) {
          console.warn('[tool-detail] Failed to clear storage:', e)
        }
        // 重置为开场白
        const tool = this.data.tool
        const messages = []
        if (tool && tool.type === 'bot' && tool.opening_statement && this.data.toolActivated) {
          messages.push({
            id: 'opening',
            role: 'system',
            content: tool.opening_statement
          })
        }
        this._setData({
          messages,
          conversationId: '',
          suggestedQuestions: tool.suggested_questions || []
        })
        wx.showToast({ title: '对话已清除', icon: 'success', duration: 1500 })
      }
    })
  },

  async loadTool(id) {
    // 加载超时保护：10 秒后强制解除 loading，防止 spinner 永远转圈
    const loadingTimeout = setTimeout(() => {
      if (this.data.loading) {
        console.warn('[loadTool] Loading timeout, force release')
        this._setData({ loading: false })
        wx.showToast({ title: '加载超时，请下拉刷新', icon: 'none' })
      }
    }, 10000)

    try {
      const data = await app.request({ url: `/api/tools/${id}`, timeout: 20000 })
      clearTimeout(loadingTimeout)

      if (data && data.tool) {
        const tool = data.tool
        const isActivated = tool.is_activated ?? false

        // 从本地存储加载该工具的对话历史
        const messages = this._loadChatHistory(id)

        // Show opening statement as system message (only if activated and no history)
        if (tool.type === 'bot' && tool.opening_statement && isActivated && messages.length === 0) {
          messages.push({
            id: 'opening',
            role: 'system',
            content: tool.opening_statement
          })
        }

        // 恢复 conversationId
        const savedConversationId = this._loadConversationId(id)

        this._setData({
          tool,
          loading: false,
          cozeConnected: data.coze_connected || false,
          botAvailable: tool.bot_available !== false,
          toolActivated: isActivated,
          messages: messages,
          conversationId: savedConversationId || '',
          suggestedQuestions: tool.suggested_questions || []
        })
      } else {
        this._setData({ loading: false })
        wx.showToast({ title: '工具不存在', icon: 'none' })
      }
    } catch (e) {
      clearTimeout(loadingTimeout)
      this._setData({ loading: false })
      // 401 错误会由 app.request 统一跳转登录页，这里不重复提示
      if (e.message !== '请先登录') {
        wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      }
    }
  },

  /**
   * 静默刷新工具信息（onShow 时调用）
   * 只更新 Coze 连接状态、prompt_info、激活状态等，不重新渲染消息列表
   */
  async refreshToolInfo() {
    if (!this._toolId) return
    try {
      const data = await app.request({ url: `/api/tools/${this._toolId}`, timeout: 15000 })
      if (data && data.tool) {
        const tool = data.tool
        const isActivated = tool.is_activated ?? false

        // 只在 prompt_info 或 cozeConnected 有变化时才更新
        this._setData({
          cozeConnected: data.coze_connected || false,
          botAvailable: tool.bot_available !== false,
          toolActivated: isActivated,
          suggestedQuestions: tool.suggested_questions || [],
          tool: Object.assign({}, this.data.tool, {
            prompt_info: tool.prompt_info,
            opening_statement: tool.opening_statement,
            suggested_questions: tool.suggested_questions,
            bot_available: tool.bot_available,
            is_activated: isActivated,
          })
        })
      }
    } catch (e) {
      // 静默失败，不干扰用户操作
      console.warn('[tool-detail] refreshToolInfo failed:', e)
    }
  },

  onInputChange(e) {
    this._setData({ inputValue: e.detail.value })
  },

  // 激活码输入变化
  onActivationCodeChange(e) {
    this._setData({ activationCode: e.detail.value, activationError: '' })
  },

  // 参数表单值变化
  onParamValueChange(e) {
    const { name } = e.currentTarget.dataset
    const value = e.detail.value
    const paramValues = { ...this.data.paramValues, [name]: value }
    this._setData({ paramValues })
  },

  // 内嵌激活（和 web 端一致）
  async handleActivate() {
    const code = this.data.activationCode.trim()
    if (!code) {
      this._setData({ activationError: '请输入激活码' })
      return
    }
    this._setData({ activating: true, activationError: '' })
    try {
      const data = await app.request({
        url: '/api/activate',
        method: 'POST',
        data: { code }
      })
      if (data && data.success) {
        this._setData({
          activationSuccess: true,
          toolActivated: true,
          activationCode: ''
        })
        // 显示开场白（如果有）
        const tool = this.data.tool
        if (tool && tool.type === 'bot' && tool.opening_statement && this.data.messages.length === 0) {
          this._setData({
            messages: [{
              id: 'opening',
              role: 'system',
              content: tool.opening_statement
            }]
          })
        }
        // 更新 tool 激活状态
        if (this.data.tool) {
          this._setData({ tool: { ...this.data.tool, is_activated: true } })
        }
        setTimeout(() => {
          this._setData({ activationSuccess: false })
        }, 1500)
      } else {
        this._setData({ activationError: data.error || '激活失败' })
      }
    } catch (e) {
      this._setData({ activationError: e.message || '激活失败，请重试' })
    } finally {
      this._setData({ activating: false })
    }
  },

  // 连接 Coze（和 web 端一致）
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

  // Go to activation page（保留兼容）
  goToActivate() {
    wx.navigateTo({ url: '/pages/activate/activate' })
  },

  // Send suggested question
  onSuggestedQuestion(e) {
    const question = e.currentTarget.dataset.question
    if (question) {
      this.sendChat(question)
    }
  },

  // ===================== 混合架构核心：sendChat =====================
  // 优先 SSE 流式（enableChunked） → 10s 无数据降级异步轮询
  async sendChat(messageText) {
    const actualText = typeof messageText === 'string' ? messageText : this.data.inputValue
    const text = actualText.trim()
    if (!text || this.data.running) return

    // Check tool activation first
    if (!this.data.toolActivated) {
      wx.showModal({
        title: '工具未激活',
        content: '请输入激活码激活此工具后使用',
        confirmText: '去激活',
        success: (res) => {
          if (res.confirm) {
            this.goToActivate()
          }
        }
      })
      return
    }

    const { tool, conversationId } = this.data

    // ===== 关键修复：强制销毁上一轮所有定时器、连接 =====
    this.cleanupTimers()

    // 生成本轮唯一 taskId（基于时间戳 + 随机数）
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Add user message
    const userMsg = {
      id: taskId + '_user',
      role: 'user',
      content: text
    }
    const messages = [...this.data.messages, userMsg]

    // Add assistant placeholder
    const assistantId = taskId + '_assistant'
    const assistantMsg = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true
    }
    messages.push(assistantMsg)

    this._setData({
      inputValue: '',
      messages: messages,
      running: true,
      errorMsg: '',
      currentTaskId: taskId,    // 绑定为本轮有效任务
    })

    // 幂等键：同一用户动作只扣费一次，防止 SSE 和兜底轮询重复扣费
    // 使用 userId 前 8 位 + taskId 后 16 位，确保总长度小于 64 且避免数据库唯一约束问题
    const userPart = (app.globalData.userInfo?.id || app.globalData.userId || 'guest').toString().slice(0, 8)
    const taskPart = taskId.slice(-16)
    const idempotencyKey = `${userPart}_${taskPart}`

    // 启动 running 状态守护定时器：无论任何回调是否触发，10 分钟后强制释放 running
    // 音视频/图片生成类工具可能需要 3-5 分钟，5 分钟不足以覆盖完整流程
    const runningGuardTimer = setTimeout(() => {
      if (taskId !== this.data.currentTaskId) return
      if (!this.data.running) return
      console.warn(`[RunningGuard] Task ${taskId} still running after 10min, force release`)
      this.cleanupTimers()
      const timeoutMsg = '任务响应超时，请重试'
      this._setData({
        messages: this.data.messages.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: timeoutMsg, isStreaming: false }
            : m
        ),
        running: false,
        currentTaskId: '',
      })
      wx.showToast({ title: timeoutMsg, icon: 'none' })
    }, 600000)
    this._setData({ runningGuardTimer })

    // 先启动 SSE 流式；SSE 失败/无内容时再由其内部启动兜底轮询，避免同时调用两次 API
    this.startStreamMode(taskId, idempotencyKey, text, assistantMsg, tool, conversationId)
  },

  /**
   * 路径 1：SSE 流式模式（enableChunked + onChunkReceived）
   * taskId: 本轮唯一任务标识，任何回调只处理当前 taskId 的结果
   * 如果 SSE 失败或 120 秒无内容，会自动降级到 startFallbackPoll
   */
  startStreamMode(taskId, idempotencyKey, text, assistantMsg, tool, conversationId) {
    let accumulatedContent = ''
    let lastChunkTime = Date.now()
    let lastContentUpdateTime = Date.now()  // 内容实际变化时间（过滤 keep-alive）
    let streamFinished = false       // 标记：SSE 是否已正常结束
    let hasReceivedChunk = false     // 标记：是否收到过至少一段文字（不含 task_id 事件）
    let serverTaskId = ''            // 服务端返回的 taskId
    let streamBuffer = ''            // SSE 跨 chunk 缓冲：解决事件被拆分到多个 chunk 的问题
    const WECHAT_TIMEOUT = 120000    // 微信 wx.request 硬限制 120 秒
    const HARD_TIMEOUT = 120000      // 与微信硬限制一致
    const that = this

    // 硬超时保护：防止 spinner 永远转圈
    const hardTimeoutTimer = setTimeout(() => {
      if (taskId !== that.data.currentTaskId) return
      if (streamFinished) return

      console.warn(`[SSE] Hard timeout reached (${HARD_TIMEOUT}ms)`)
      streamFinished = true
      clearInterval(noDataTimer)
      clearTimeout(hardTimeoutTimer)
      that._setData({ noDataTimer: null })

      // 中断流式连接
      if (that.data.streamTask) {
        try { that.data.streamTask.abort() } catch (e) { /* ignore */ }
        that._setData({ streamTask: null })
      }

      // 已经有内容 → 结束当前任务并释放 running，确保复制按钮显示且可重新发送
      if (hasReceivedChunk && accumulatedContent) {
        that._setData({
          messages: that.data.messages.map(m =>
            m.id === assistantMsg.id
              ? { ...m, content: accumulatedContent, isStreaming: false }
              : m
          ),
          running: false
        })
      } else {
        // 没有内容 → 启动兜底轮询，避免 running 永远卡住
        console.log('[SSE] Hard timeout with no chunks, starting fallback polling')
        that.startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, null, serverTaskId)
      }
    }, HARD_TIMEOUT)

    // 启动无数据监控定时器
    // 1) 每 15 秒打印日志
    // 2) 如果已经收到内容且 30 秒没有新数据，认为 SSE 已静默结束，主动释放 running
    const streamStartTime = Date.now()
    const NO_NEW_DATA_GUARD = 15000  // 15 秒无新数据且已有内容 → 释放 running
    const noDataTimer = setInterval(() => {
      // 非当前任务 → 立即停止
      if (taskId !== that.data.currentTaskId) {
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        return
      }

      // 已经正常结束 → 停止监控
      if (streamFinished) {
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        that._setData({ noDataTimer: null })
        return
      }

      const elapsed = Date.now() - lastChunkTime
      const contentStallElapsed = Date.now() - lastContentUpdateTime
      const totalElapsed = Date.now() - streamStartTime

      // 日志记录
      if (totalElapsed % 15000 < 1000) {  // 每 15 秒打印一次状态
        console.log(`[SSE] Status: ${totalElapsed}ms elapsed, ${elapsed}ms since last chunk, ${contentStallElapsed}ms since content changed, hasChunk: ${hasReceivedChunk}`)
      }

      // 安全网：已有内容但长时间无新数据 → 结束流式并释放 running
      // 同时检测内容是否真正停滞（过滤 keep-alive / ping 包）
      const shouldReleaseByChunk = hasReceivedChunk && elapsed > NO_NEW_DATA_GUARD && that.data.running
      const shouldReleaseByContent = hasReceivedChunk && contentStallElapsed > NO_NEW_DATA_GUARD && that.data.running
      if (shouldReleaseByChunk || shouldReleaseByContent) {
        console.warn(`[SSE] No new data for ${elapsed}ms (content stalled ${contentStallElapsed}ms), force releasing running state`)
        streamFinished = true
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        if (that.data.streamTask) {
          try { that.data.streamTask.abort() } catch (e) { /* ignore */ }
        }
        that._setData({
          noDataTimer: null,
          streamTask: null,
          messages: that.data.messages.map(m =>
            m.id === assistantMsg.id
              ? { ...m, content: accumulatedContent, isStreaming: false }
              : m
          ),
          running: false
        })
      }

      // 早期兜底：SSE 建立后 30 秒仍没有任何数据（连 task_id 都没收到）→ 启动兜底轮询
      // 避免某些情况下 SSE 连接已建立但后端无响应，导致必须等到 120s 硬超时
      if (!hasReceivedChunk && !serverTaskId && totalElapsed > 30000 && that.data.running && !that.data.pollTimer) {
        console.warn(`[SSE] No data at all for ${totalElapsed}ms, starting early fallback polling`)
        streamFinished = true
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        if (that.data.streamTask) {
          try { that.data.streamTask.abort() } catch (e) { /* ignore */ }
        }
        that._setData({ noDataTimer: null, streamTask: null })
        that.startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, null, serverTaskId)
      }
    }, 1000)

    this._setData({ noDataTimer })

    // 收到完整消息或流结束标记时立即结束流式
    function finishStream() {
      if (streamFinished) return
      streamFinished = true
      clearInterval(noDataTimer)
      clearTimeout(hardTimeoutTimer)
      if (that.data.streamTask) {
        try { that.data.streamTask.abort() } catch (e) { /* ignore */ }
      }
      that._setData({
        noDataTimer: null,
        streamTask: null,
        messages: that.data.messages.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: accumulatedContent || m.content, isStreaming: false }
            : m
        ),
        running: false
      })
    }

    const requestTask = wx.request({
      url: `${app.globalData.apiBase}/api/workflow/stream`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'x-session': app.globalData.token,
      },
      data: {
        tool_id: tool.id,
        parameters: { input: text },
        conversation_id: conversationId || undefined,
        idempotency_key: idempotencyKey,
      },
      enableChunked: true,    // 关键：开启分片接收
      timeout: 120000,        // 微信硬限制 120 秒，超时后由降级轮询接管

      // ===== 分片接收回调（打字机效果） =====
      onChunkReceived(res) {
        // ===== 关键：旧任务分片，直接抛弃 =====
        if (taskId !== that.data.currentTaskId) return
        if (streamFinished) return   // SSE 已完成，不再处理

        lastChunkTime = Date.now()

        const chunkStr = typeof res.data === 'string' 
          ? res.data 
          : (res.data instanceof ArrayBuffer 
            ? that.arrayBufferToString(res.data) 
            : '')

        if (!chunkStr) return

        // ===== 检测非 SSE 的 JSON 错误响应（如数据库错误、认证错误等） =====
        // 当服务器返回非 SSE 格式的错误时（如 402 积分不足），
        // enableChunked 模式下数据也可能通过 onChunkReceived 到达
        if (!hasReceivedChunk && !chunkStr.includes('event:') && !chunkStr.includes('data:')) {
          try {
            const maybeError = JSON.parse(chunkStr.trim())
            if (maybeError && maybeError.error) {
              console.warn('[SSE] Received non-SSE JSON error via chunk:', maybeError.error)
              streamFinished = true
              clearInterval(noDataTimer)
              clearTimeout(hardTimeoutTimer)
              that._setData({ noDataTimer: null, streamTask: null })
              that._setData({
                messages: that.data.messages.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: maybeError.error, isStreaming: false }
                    : m
                ),
                running: false
              })
              return
            }
          } catch (e) { /* not JSON, normal SSE chunk */ }
        }

        // 解析 SSE 事件（带跨 chunk 缓冲）
        streamBuffer += chunkStr
        const lines = streamBuffer.split('\n')
        // 保留不完整的最后一行，等待下一个 chunk 补齐
        streamBuffer = lines.pop() || ''
        let currentEvent = ''

        for (const line of lines) {
          const trimmed = line.trim()

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim()
            continue
          }

            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (!dataStr) continue

              // 流结束标记
              if (currentEvent === 'done' || dataStr === '[DONE]') {
                if (hasReceivedChunk && accumulatedContent) {
                  finishStream()
                } else {
                  // 无内容 → 启动兜底轮询
                  streamFinished = true
                  clearInterval(noDataTimer)
                  clearTimeout(hardTimeoutTimer)
                  that._setData({ noDataTimer: null, streamTask: null })
                  that.startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, null, serverTaskId)
                }
                break
              }

              try {
                const data = JSON.parse(dataStr)

              // ===== 捕获服务端 task_id（用于降级轮询直接查询状态） =====
              if (currentEvent === 'task_id' && data.task_id) {
                serverTaskId = data.task_id
                console.log('[SSE] Captured server task_id:', serverTaskId)
                continue
              }

              // 增量内容（打字机核心）
              if (currentEvent === 'conversation.message.delta' && data.type === 'answer' && data.content) {
                hasReceivedChunk = true  // 收到真正的文本内容
                accumulatedContent += data.content
                lastContentUpdateTime = Date.now()
                that._setData({
                  messages: that.data.messages.map(m =>
                    m.id === assistantMsg.id
                      ? { ...m, content: accumulatedContent }
                      : m
                  )
                })
              }

              // 完整消息
              if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
                hasReceivedChunk = true  // 收到真正的文本内容
                if (!accumulatedContent) {
                  accumulatedContent = data.content
                }
                lastContentUpdateTime = Date.now()
                finishStream()
                break
              }

              // 对话完成（某些 bot 只发此事件，不单独发 message.completed）
              if (currentEvent === 'conversation.chat.completed') {
                if (!accumulatedContent && data.content) {
                  accumulatedContent = data.content
                  hasReceivedChunk = true
                }
                if (data.content) lastContentUpdateTime = Date.now()
                finishStream()
                break
              }

              // 捕获 conversation_id
              if (data.conversation_id && !that.data.conversationId) {
                that._setData({ conversationId: data.conversation_id })
              }

              // 失败事件
              if (currentEvent === 'conversation.chat.failed') {
                streamFinished = true
                clearInterval(noDataTimer)
                clearTimeout(hardTimeoutTimer)
                that._setData({ noDataTimer: null })

                // 已收到过内容 → 不清空，保留已有内容
                if (hasReceivedChunk) {
                  that._setData({
                    messages: that.data.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: accumulatedContent, isStreaming: false }
                        : m
                    ),
                    running: false
                  })
                } else {
                  const failMsg = data.last_error?.msg || '对话失败，请重试'
                  that._setData({
                    messages: that.data.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: failMsg, isStreaming: false }
                        : m
                    ),
                    running: false
                  })
                }
              }

              // 错误事件
              if (currentEvent === 'error' || data.error_code) {
                streamFinished = true
                clearInterval(noDataTimer)
                clearTimeout(hardTimeoutTimer)
                that._setData({ noDataTimer: null })

                // 已收到过内容 → 不清空
                if (hasReceivedChunk) {
                  that._setData({
                    messages: that.data.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: accumulatedContent, isStreaming: false }
                        : m
                    ),
                    running: false
                  })
                } else {
                  const errMsg = data.error_message || data.msg || '调用出错'
                  that._setData({
                    messages: that.data.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: `错误: ${errMsg}`, isStreaming: false }
                        : m
                    ),
                    running: false
                  })
                }
              }
            } catch (e) {
              // 非 JSON 行，跳过
            }
          }
        }
      },

      // ===== 流式请求成功结束 =====
      success(res) {
        // ===== 关键：旧任务回调，直接忽略 =====
        if (taskId !== that.data.currentTaskId) return
        if (streamFinished) return

        streamFinished = true
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        that._setData({ noDataTimer: null, streamTask: null })

        console.log(`[SSE] success, hasReceivedChunk: ${hasReceivedChunk}, accumulated: ${accumulatedContent.length} chars`)

        // 检查是否是 JSON 错误响应（非 SSE）
        // 注意：微信小程序 wx.request 返回的 header key 全部是小写
        const contentType = (res.header && (res.header['content-type'] || res.header['Content-Type'])) || ''
        // 额外判断：HTTP 状态码非 200 且 res.data 为对象 → 直接当 JSON 错误处理
        const isErrorResponse = (res.statusCode && res.statusCode >= 400 && res.data && typeof res.data === 'object')
        if ((contentType && contentType.includes('application/json') && res.data) || isErrorResponse) {
          let errData = res.data
          if (typeof errData === 'string') {
            try { errData = JSON.parse(errData) } catch (e) { /* keep as string */ }
          }
          if (errData && errData.needCozeAuth) {
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: '请先连接 Coze 账户', isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
          if (errData && errData.needActivation) {
            that._setData({
              toolActivated: false,
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: '此工具需要激活码，请先激活后再使用。', isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
          if (errData && errData.retryable) {
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: errData.error || '当前使用人数较多，请稍后重试', isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
          if (errData && errData.syncResult && errData.syncResult.output) {
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: errData.syncResult.output, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
          if (errData && errData.error) {
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: errData.error, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
          // 兜底：有 data 但没有匹配到任何已知错误类型，并且状态码异常
          if (res.statusCode && res.statusCode >= 400 && errData) {
            const fallbackMsg = (typeof errData === 'string') ? errData : JSON.stringify(errData)
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: `服务器返回错误 (${res.statusCode}): ${fallbackMsg}`, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
        }

        // SSE 有内容 → 直接显示并清理独立轮询
        if (hasReceivedChunk) {
          // 清理独立轮询（不再需要）
          if (that.data.pollTimer) {
            clearInterval(that.data.pollTimer)
            that._setData({ pollTimer: null })
          }
          that._setData({
            messages: that.data.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: accumulatedContent, isStreaming: false }
                : m
            ),
            running: false
          })
          return
        }

        // 兜底：即使 hasReceivedChunk 为 false，只要消息里已经有内容也结束（防止最后一个 chunk 没触发标记）
        const existingMsg = that.data.messages.find(m => m.id === assistantMsg.id)
        const existingContent = existingMsg ? existingMsg.content : ''
        if (existingContent) {
          if (that.data.pollTimer) {
            clearInterval(that.data.pollTimer)
            that._setData({ pollTimer: null })
          }
          that._setData({
            messages: that.data.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, isStreaming: false }
                : m
            ),
            running: false
          })
          return
        }

        // 没收到 chunk：尝试从 res.data 解析（Nginx 可能缓冲了完整响应）
        if (res.data && typeof res.data === 'string') {
          console.log('[SSE] No chunks received, parsing res.data as full SSE body')
          const lines = res.data.split('\n')
          let currentEvent = ''
          let fullContent = ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim()
            } else if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (!dataStr || dataStr === '[DONE]') continue
              try {
                const data = JSON.parse(dataStr)
                if (currentEvent === 'conversation.message.delta' && data.type === 'answer' && data.content) {
                  fullContent += data.content
                }
                if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
                  if (!fullContent) fullContent = data.content
                }
                if (data.conversation_id && !that.data.conversationId) {
                  that._setData({ conversationId: data.conversation_id })
                }
              } catch (e) { /* skip */ }
            }
          }
          if (fullContent) {
            console.log('[SSE] Parsed full content from res.data, length:', fullContent.length)
            if (that.data.pollTimer) {
              clearInterval(that.data.pollTimer)
              that._setData({ pollTimer: null })
            }
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: fullContent, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }
        }

        // SSE 完全没内容 → 启动兜底轮询
        console.log('[SSE] No content, starting fallback polling')
        that.startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, null, serverTaskId)

        // 兜底：success 末尾如果 running 仍为 true，强制释放（理论上不应走到这里）
        if (that.data.running) {
          console.warn('[SSE] success callback ended but running still true, force release')
          that._setData({ running: false })
        }
      },

      // ===== 流式请求失败（含微信 120 秒超时强制断连） =====
      fail(err) {
        if (taskId !== that.data.currentTaskId) return
        if (streamFinished) return

        streamFinished = true
        clearInterval(noDataTimer)
        clearTimeout(hardTimeoutTimer)
        that._setData({ noDataTimer: null, streamTask: null })

        console.warn('[SSE] Request failed:', err.errMsg || err.message)

        // 已经收到内容 → 直接结束并释放状态（确保有复制按钮且可重新发送）
        if (hasReceivedChunk) {
          that._setData({
            messages: that.data.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: accumulatedContent, isStreaming: false }
                : m
            ),
            running: false
          })
          return
        }

        // 兜底：只要消息里已经有内容，就直接结束，不启动轮询
        const existingMsg = that.data.messages.find(m => m.id === assistantMsg.id)
        if (existingMsg && existingMsg.content) {
          that._setData({
            messages: that.data.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, isStreaming: false }
                : m
            ),
            running: false
          })
          return
        }

        // 没有内容 → 启动兜底轮询
        console.log('[SSE] No chunks received, starting fallback polling')
        that.startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, null, serverTaskId)

        // 兜底：fail 末尾如果 running 仍为 true，强制释放（理论上不应走到这里）
        if (that.data.running) {
          console.warn('[SSE] fail callback ended but running still true, force release')
          that._setData({ running: false })
        }
      }
    })

    this._setData({ streamTask: requestTask })
  },

  /**
   * 独立兜底轮询模式
   * 始终通过 task/run 创建独立的异步任务 → task/status 轮询结果
   * 与 SSE 流式同时运行，SSE 成功则清理此轮询
   * taskId: 本轮唯一任务标识，非当前任务立即停止
   */
  async startFallbackPoll(taskId, idempotencyKey, text, assistantMsg, tool, conversationId, hardTimeoutTimer, serverTaskId) {
    const that = this

    // ===== 关键：非当前任务，直接放弃 =====
    if (taskId !== this.data.currentTaskId) return

    // 设置轮询自身的硬超时
    const fallbackHardTimeout = setTimeout(() => {
      if (taskId !== that.data.currentTaskId) return

      console.warn('[Fallback] Hard timeout, force finishing')
      if (that.data.pollTimer) {
        clearInterval(that.data.pollTimer)
        that._setData({ pollTimer: null })
      }

      // 获取当前消息内容，不清空（SSE 可能已经显示了部分内容）
      const currentMsgs = that.data.messages
      const assistantMsgData = currentMsgs.find(m => m.id === assistantMsg.id)
      const currentContent = assistantMsgData ? assistantMsgData.content : ''

      // 已收到内容 → 不修改，只解除 running
      if (currentContent) {
        that._setData({
          messages: currentMsgs.map(m =>
            m.id === assistantMsg.id
              ? { ...m, isStreaming: false }
              : m
          ),
          running: false
        })
        return
      }

      // 未收到内容 → 改为"生成时间较长"提示，不再粗暴地告诉用户超时
      // 原因：音视频生成实际可能需要 3-5 分钟，这里"超时"会让用户误以为失败
      that._setData({
        messages: currentMsgs.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: '任务生成时间较长，可能仍在后台处理中，请稍候片刻或刷新页面查看任务列表', isStreaming: false }
            : m
        ),
        running: false
      })
    }, 600000)  // 10 分钟：覆盖音视频生成全流程（后端 maxDuration 300s，留足余量）

    try {
      // 如果 SSE 已经注入了 serverTaskId，优先复用该任务，避免重复创建任务和重复扣费
      let pollTaskId = serverTaskId
      if (!pollTaskId) {
        console.log('[Fallback] Creating independent task via task/run')
        const taskRes = await app.request({
          url: '/api/workflow/task/run',
          method: 'POST',
          timeout: 30000,
          data: {
            tool_id: tool.id,
            parameters: { input: text },
            conversation_id: conversationId || undefined,
            idempotency_key: idempotencyKey,
          }
        })

        // ===== 关键：请求返回时任务可能已过期 =====
        if (taskId !== this.data.currentTaskId) {
          clearTimeout(fallbackHardTimeout)
          return
        }

        pollTaskId = taskRes.taskId
        if (!pollTaskId) {
          clearTimeout(fallbackHardTimeout)
          // Workflow 类型同步返回
          if (taskRes.syncResult) {
            const content = typeof taskRes.syncResult === 'string'
              ? taskRes.syncResult
              : (taskRes.syncResult.output || JSON.stringify(taskRes.syncResult))
            this._setData({
              messages: this.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content, isStreaming: false }
                  : m
              ),
              conversationId: taskRes.syncResult.conversation_id || conversationId,
              running: false
            })
            return
          }
          throw new Error('任务创建失败')
        }

        console.log('[Fallback] Created task:', pollTaskId)
      } else {
        console.log('[Fallback] Reusing server task_id:', pollTaskId)
      }

      // 步骤 2: 轮询任务状态
      const POLL_INTERVAL = 2000   // 2 秒间隔
      const MAX_POLLS = 200        // 最多 200 次（约 6.7 分钟，覆盖音视频生成全流程）
      let pollCount = 0
      let hasPollContent = false   // 是否已通过轮询拿到过内容

      const pollTimer = setInterval(async () => {
        pollCount++

        // ===== 关键：非当前任务，立即停止 =====
        if (taskId !== that.data.currentTaskId) {
          clearInterval(pollTimer)
          that._setData({ pollTimer: null })
          return
        }

        if (pollCount >= MAX_POLLS) {
          clearInterval(pollTimer)
          clearTimeout(fallbackHardTimeout)
          that._setData({ pollTimer: null })

          // 已有内容 → 不清空，标记消息完成，解除运行状态
          if (hasPollContent) {
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }

          // 未收到内容 → 友好提示，避免"超时请重试"误导用户
          that._setData({
            messages: that.data.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: '任务生成时间较长，可能仍在后台处理中，请稍候片刻或刷新页面查看任务列表', isStreaming: false }
                : m
            ),
            running: false
          })
          return
        }

        try {
          const statusRes = await app.request({
            url: `/api/workflow/task/status?taskId=${pollTaskId}`,
            method: 'GET',
            timeout: 10000,
          })

          // ===== 关键：请求返回后再次校验任务归属 =====
          if (taskId !== that.data.currentTaskId) {
            clearInterval(pollTimer)
            that._setData({ pollTimer: null })
            return
          }

          // status=pending（AI 还在处理）→ 只轮询，不修改页面文字
          if (statusRes.status === 'pending') {
            return
          }

          if (statusRes.status === 'completed') {
            clearInterval(pollTimer)
            clearTimeout(fallbackHardTimeout)
            that._setData({ pollTimer: null })
            hasPollContent = true
            const content = statusRes.result?.output || statusRes.chunk || '智能体已回复'

            // 检查 SSE 是否已经显示了内容，避免覆盖
            const currentMsgs = that.data.messages
            const existingMsg = currentMsgs.find(m => m.id === assistantMsg.id)
            const existingContent = existingMsg ? existingMsg.content : ''
            const alreadyHasContent = existingContent && existingContent.length > 0

            // 如果 SSE 已经显示了内容且消息已完成，不要覆盖
            if (alreadyHasContent && !existingMsg.isStreaming) {
              that._setData({ running: false })
              return
            }

            that._setData({
              messages: currentMsgs.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: alreadyHasContent || content, isStreaming: false }
                  : m
              ),
              conversationId: statusRes.result?.conversation_id || conversationId,
              running: false
            })
            return
          }

          if (statusRes.status === 'failed') {
            clearInterval(pollTimer)
            clearTimeout(fallbackHardTimeout)
            that._setData({ pollTimer: null })

            // 检查 SSE 是否已经显示了内容
            const currentMsgs = that.data.messages
            const existingMsg = currentMsgs.find(m => m.id === assistantMsg.id)
            const existingContent = existingMsg ? existingMsg.content : ''

            // 已有内容 → 只标记完成，不清空，确保复制按钮显示且可重新发送
            if (hasPollContent || existingContent) {
              that._setData({
                messages: currentMsgs.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, isStreaming: false }
                    : m
                ),
                running: false
              })
              return
            }

            const errMsg = statusRes.error || '智能体执行失败'
            that._setData({
              messages: currentMsgs.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: errMsg, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }

          // running 状态：显示增量内容
          if (statusRes.chunk && statusRes.chunk.length > 0) {
            hasPollContent = true
            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: statusRes.chunk }
                  : m
              )
            })
          }

        } catch (pollErr) {
          const errMsg = (pollErr && pollErr.message) ? pollErr.message : ''

          // ===== 关键：请求异常后校验任务归属 =====
          if (taskId !== that.data.currentTaskId) {
            clearInterval(pollTimer)
            that._setData({ pollTimer: null })
            return
          }

          // 后端明确返回 failed → 不重试
          if (errMsg === '智能体执行失败' || errMsg.includes('网络连接不稳定') ||
              errMsg.includes('智能体服务异常') || errMsg.includes('智能体执行失败') ||
              errMsg.includes('图像处理节点排队拥挤')) {
            clearInterval(pollTimer)
            clearTimeout(fallbackHardTimeout)
            that._setData({ pollTimer: null })

            // 已有内容 → 只标记完成，不清空，确保复制按钮显示
            const currentMsgs = that.data.messages
            const existingMsg = currentMsgs.find(m => m.id === assistantMsg.id)
            if (hasPollContent || (existingMsg && existingMsg.content)) {
              that._setData({
                messages: currentMsgs.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, isStreaming: false }
                    : m
                ),
                running: false
              })
              return
            }

            that._setData({
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: errMsg, isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }

          // needActivation 异常：若已有内容，先标记完成再提示激活
          if (pollErr && pollErr.needActivation) {
            clearInterval(pollTimer)
            clearTimeout(fallbackHardTimeout)
            that._setData({ pollTimer: null })

            const currentMsgs = that.data.messages
            const existingMsg = currentMsgs.find(m => m.id === assistantMsg.id)
            if (existingMsg && existingMsg.content) {
              that._setData({
                messages: currentMsgs.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, isStreaming: false }
                    : m
                ),
                running: false
              })
              // 继续提示激活，但已显示的内容保留
              that._setData({ toolActivated: false })
              wx.showToast({ title: '此工具需要激活，请激活后继续使用', icon: 'none' })
              return
            }

            that._setData({
              toolActivated: false,
              messages: that.data.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: '此工具需要激活码，请先激活后再使用。', isStreaming: false }
                  : m
              ),
              running: false
            })
            return
          }

          // 网络抖动 → 继续重试
          console.warn(`[Fallback] Poll ${pollCount}/${MAX_POLLS} error:`, errMsg)
        }
      }, POLL_INTERVAL)

      // 存入 data 方便 cleanupTimers 统一清理
      that._setData({ pollTimer })

    } catch (e) {
      clearTimeout(fallbackHardTimeout)
      // ===== 关键：异常时校验任务归属 =====
      if (taskId !== this.data.currentTaskId) return

      const errMsg = (e && e.message) ? e.message : '发送失败'

      // 如果 SSE 已经显示了内容，不要覆盖，只结束流式状态
      const currentMsgs = this.data.messages
      const existingMsg = currentMsgs.find(m => m.id === assistantMsg.id)
      const existingContent = existingMsg ? existingMsg.content : ''

      if (existingContent) {
        this._setData({
          messages: currentMsgs.map(m =>
            m.id === assistantMsg.id
              ? { ...m, isStreaming: false }
              : m
          ),
          running: false
        })
        return
      }

      if (e && e.needActivation) {
        this._setData({
          toolActivated: false,
          messages: currentMsgs.map(m =>
            m.id === assistantMsg.id
              ? { ...m, content: '此工具需要激活码，请先激活后再使用。', isStreaming: false }
              : m
          ),
          running: false
        })
        return
      }

      if (e && e.needCozeAuth) {
        this._setData({
          messages: currentMsgs.map(m =>
            m.id === assistantMsg.id
              ? { ...m, content: '请先连接 Coze 账户', isStreaming: false }
              : m
          ),
          running: false
        })
        return
      }

      this._setData({
        messages: currentMsgs.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: `发送失败: ${errMsg}`, isStreaming: false }
            : m
        ),
        running: false
      })
    }
  },

  // ArrayBuffer 转字符串（小程序 onChunkReceived 可能返回 ArrayBuffer）
  arrayBufferToString(buffer) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(new Uint8Array(buffer))
    }
    // Fallback for older WeChat versions
    let str = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i])
    }
    return decodeURIComponent(escape(str))
  },

  // 重置参数表单
  resetParamForm() {
    this._setData({ paramValues: {} })
  },

  // 压缩图片：限制最长边 + 降低质量，避免原图过大导致 Coze 下载图片链接超时
  // 任何异常或压缩失败都回退为原图，保证功能不受影响
  async compressImageForUpload(src) {
    const MAX_DIM = 2000   // 最长边上限（与 Web 端一致）
    const QUALITY = 80     // 压缩质量 0-100
    let width = 0
    let height = 0
    try {
      const info = await new Promise((resolve, reject) =>
        wx.getImageInfo({ src, success: resolve, fail: reject })
      )
      width = info.width || 0
      height = info.height || 0
    } catch (e) {
      width = 0
      height = 0
    }

    const opt = { src, quality: QUALITY }
    if (width && height) {
      if (width >= height && width > MAX_DIM) opt.compressedWidth = MAX_DIM
      else if (height > width && height > MAX_DIM) opt.compressedHeight = MAX_DIM
    }

    return new Promise((resolve) => {
      wx.compressImage({
        src: opt.src,
        quality: opt.quality,
        compressedWidth: opt.compressedWidth,
        compressedHeight: opt.compressedHeight,
        success: (res) => resolve((res && res.tempFilePath) || src),
        fail: () => resolve(src),
      })
    })
  },

  // 媒体文件上传（图片/音频/视频）
  async onMediaUpload(e) {
    const { name, type } = e.currentTarget.dataset
    const mediaType = type || 'image'
    const typeLabel = mediaType === 'image' ? '图片' : mediaType === 'audio' ? '音频' : '视频'

    try {
      let filePath = ''
      if (mediaType === 'image') {
        // 图片：使用 chooseImage，支持相册和相机
        const res = await new Promise((resolve, reject) => {
          wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject
          })
        })
        filePath = res.tempFilePaths[0]
        // 上传前先压缩，避免原图过大导致 Coze 工作流下载图片链接超时
        try {
          const compressed = await this.compressImageForUpload(filePath)
          if (compressed && compressed !== filePath) {
            console.log('[MediaUpload] 图片已压缩:', filePath, '->', compressed)
          }
          filePath = compressed || filePath
        } catch (e) {
          console.warn('[MediaUpload] 图片压缩失败，使用原图', e)
        }
      } else if (mediaType === 'video') {
        // 视频：使用 chooseMedia，从相册选择，不会跳微信聊天
        const res = await new Promise((resolve, reject) => {
          wx.chooseMedia({
            count: 1,
            mediaType: ['video'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject
          })
        })
        filePath = res.tempFiles[0].tempFilePath
      } else {
        // 音频：使用 chooseMessageFile（微信限制，音频只能从聊天记录选择）
        // 先弹窗提示用户操作步骤
        const userConfirmed = await new Promise((resolveConfirm) => {
          wx.showModal({
            title: '上传音频',
            content: '由于微信限制，音频文件需要先从聊天记录中选择。\n\n请先将音频文件（mp3/wav/ogg等）发送到任意微信聊天（如文件传输助手），然后点击"确定"从聊天记录中选择。',
            confirmText: '确定',
            cancelText: '取消',
            success: (modalRes) => resolveConfirm(modalRes.confirm)
          })
        })
        if (!userConfirmed) return

        // 检测 chooseMessageFile 是否可用（iOS 某些版本可能不支持）
        if (typeof wx.chooseMessageFile !== 'function') {
          wx.showModal({
            title: '提示',
            content: '当前微信版本不支持从聊天记录选择音频文件。\n\n替代方案：请将音频文件发送到微信聊天后，长按文件选择"用其他应用打开"分享到本小程序，或使用 Web 端上传。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }

        try {
          const res = await new Promise((resolve, reject) => {
            wx.chooseMessageFile({
              count: 1,
              type: 'audio',
              extension: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'],
              success: resolve,
              fail: reject
            })
          })
          filePath = res.tempFiles[0].path
        } catch (chooseErr) {
          const errMsg = chooseErr.errMsg || chooseErr.message || ''
          console.error('[MediaUpload] chooseMessageFile failed:', errMsg)

          // iOS 特有错误处理
          if (errMsg.includes('fail') || errMsg.includes('cancel')) {
            if (errMsg.includes('cancel')) {
              // 用户取消，静默返回
              return
            }
            // 无法打开聊天记录 → 给出替代方案
            wx.showModal({
              title: '无法选择音频',
              content: '无法打开微信聊天记录选择器。\n\n请确保：\n1. 已将音频文件发送到微信聊天中\n2. 微信已授予"聊天记录"访问权限\n\n或使用 Web 端上传音频文件。',
              showCancel: false,
              confirmText: '知道了'
            })
            return
          }
          throw chooseErr
        }
      }

      if (!filePath) return

      wx.showLoading({ title: `上传${typeLabel}中...` })

      // 上传到服务器
      const token = getApp().globalData.token
      const apiBase = getApp().globalData.apiBase

      const uploadRes = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: `${apiBase}/api/upload/media`,
          filePath: filePath,
          name: 'file',
          header: {
            'x-session': token
          },
          timeout: 120000,  // 120 秒上传超时（大文件需要更长时间）
          success: resolve,
          fail: reject
        })
      })

      wx.hideLoading()

      if (uploadRes.statusCode >= 200 && uploadRes.statusCode < 300) {
        let data
        try { data = JSON.parse(uploadRes.data) } catch { data = {} }
        if (data.success && data.url) {
          // 更新参数值
          const paramValues = { ...this.data.paramValues, [name]: data.url }
          this._setData({ paramValues })
          wx.showToast({ title: `上传成功`, icon: 'success' })
        } else {
          wx.showToast({ title: data.error || '上传失败', icon: 'none' })
        }
      } else if (uploadRes.statusCode === 401) {
        wx.showToast({ title: '请先登录', icon: 'none' })
      } else {
        let errMsg = '上传失败，请稍后重试'
        try {
          const errData = JSON.parse(uploadRes.data || '{}')
          errMsg = errData.error || errMsg
        } catch {
          errMsg = `服务器错误 (${uploadRes.statusCode})，请稍后重试`
        }
        wx.showToast({ title: errMsg, icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error(`[MediaUpload] ${mediaType} upload error:`, err)
      if (err.errMsg && err.errMsg.includes('cancel')) return

      // 上传失败 → 根据类型给出具体建议
      let toastMsg = err.message || `上传${typeLabel}失败`
      if (mediaType === 'audio' && (err.errMsg || '').includes('fail')) {
        // 音频选择器调用失败（iOS 常见）
        wx.showModal({
          title: '上传失败',
          content: '无法从聊天记录选择音频文件。\n\n可能原因：\n• 微信未授予聊天记录访问权限\n• 当前微信版本不支持\n\n建议使用 Web 端（浏览器打开 coze.mooibi.com）上传音频。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({ title: toastMsg, icon: 'none' })
    }
  },

  // 发送参数表单内容
  sendParamForm() {
    // 防止重复点击
    if (this.data.running) return

    const schema = this.data.tool?.parameters_schema
    if (!schema || !schema.length) return

    const paramValues = this.data.paramValues
    // 校验必填项
    const missingRequired = schema.filter(
      p => p.required && !paramValues[p.name]?.trim() && !p.defaultValue
    )
    if (missingRequired.length > 0) {
      wx.showToast({
        title: '请填写：' + missingRequired.map(p => p.label).join('、'),
        icon: 'none'
      })
      return
    }
    // 组装所有有值的参数
    const parts = schema
      .filter(p => paramValues[p.name]?.trim() || p.defaultValue)
      .map(p => `${p.label}：${paramValues[p.name]?.trim() || p.defaultValue}`)
    if (parts.length > 0) {
      this.sendChat(parts.join('\n'))
    }
  },

  // 返回工具列表
  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/tools/tools' }) })
  },

  // Run workflow (non-bot type)
  async handleRunWorkflow() {
    const { tool, inputValue } = this.data
    if (!tool || !inputValue.trim()) return

    if (!this.data.toolActivated) {
      wx.showModal({
        title: '工具未激活',
        content: '请输入激活码激活此工具后使用',
        confirmText: '去激活',
        success: (res) => {
          if (res.confirm) {
            this.goToActivate()
          }
        }
      })
      return
    }

    this._setData({ running: true, errorMsg: '' })

    // 记录用户输入并清空输入框
    const userText = inputValue.trim()
    const userMsg = {
      id: Date.now().toString() + '_user',
      role: 'user',
      content: userText
    }
    this._setData({
      messages: [...this.data.messages, userMsg],
      inputValue: ''
    })

    try {
      // 幂等键：防止快速双击导致重复扣费
      const userPart = (app.globalData.userInfo?.id || app.globalData.userId || 'guest').toString().slice(0, 8)
      const taskPart = `workflow_${tool.id}_${Date.now()}`.slice(-24)
      const idempotencyKey = `${userPart}_${taskPart}`

      const res = await app.request({
        url: '/api/workflow/run',
        method: 'POST',
        data: {
          tool_id: tool.id,
          parameters: { input: userText },
          idempotency_key: idempotencyKey,
        }
      })

      const output = extractWorkflowOutput(res)
      this._setData({
        messages: [...this.data.messages, {
          id: Date.now().toString(),
          role: 'assistant',
          content: output,
          isStreaming: false
        }],
        running: false
      })
    } catch (e) {
      this._setData({
        errorMsg: e.message || '执行失败',
        running: false
      })
    }
  },

  // Copy message content
  copyMessage(e) {
    const text = e.currentTarget.dataset.content
    if (!text) return
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' })
      }
    })
  },

  // 复制单个链接（链接卡片上的按钮）
  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return

    const conversationId = this.data.conversationId
    const isVideoLink = /\.(mp4|avi|mov|mkv|wmv|flv|webm)(\?.*)?$/i.test(url)
    const hasTosSignature = /[?&]X-Tos-(Algorithm|Signature|Credential)=/i.test(url)

    if (hasTosSignature && conversationId) {
      // 有 conversation_id 且是 TOS 签名 URL → 先刷新签名再复制，避免复制已过期链接
      const baseUrl = url.split('?')[0]
      this._refreshFileUrl(conversationId, baseUrl, isVideoLink)
      return
    }

    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  },

  // 预览图片
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({
      urls: [url],
      current: url,
    })
  },

  // 打开链接（单击：尝试刷新签名 URL，失败则复制原始链接 + 提示）
  openLink(e) {
    const url = e.currentTarget.dataset.fullUrl
    if (!url) return

    const that = this
    const isVideoLink = /\.(mp4|avi|mov|mkv|wmv|flv|webm)(\?.*)?$/i.test(url)
    const conversationId = that.data.conversationId

    // 检测是否为 TOS/CDN 签名 URL（需要刷新）
    const hasTosSignature = /[?&]X-Tos-(Algorithm|Signature|Credential)=/i.test(url)
    const baseUrl = url.split('?')[0]

    if (hasTosSignature && conversationId) {
      // 有 conversation_id → 尝试从 Coze 刷新签名 URL
      wx.showLoading({ title: '正在刷新链接...', mask: true })
      that._refreshFileUrl(conversationId, baseUrl, isVideoLink)
      return
    }

    // 无需刷新（无签名或没有 conversationId）→ 直接复制
    that._copyLinkToClipboard(url, isVideoLink, hasTosSignature ? 'expired' : 'fresh')
  },

  // 长按：尝试刷新签名 URL，失败则复制永久链接（无签名）
  copyLinkPermanent(e) {
    const url = e.currentTarget.dataset.fullUrl
    if (!url) return

    const that = this
    const isVideoLink = /\.(mp4|avi|mov|mkv|wmv|flv|webm)(\?.*)?$/i.test(url)
    const conversationId = that.data.conversationId
    const baseUrl = url.split('?')[0]

    if (conversationId) {
      wx.showLoading({ title: '正在刷新链接...', mask: true })
      that._refreshFileUrl(conversationId, baseUrl, isVideoLink)
      return
    }

    // 无法刷新 → 复制永久链接
    wx.setClipboardData({
      data: baseUrl,
      success() {
        wx.showToast({ title: '已复制永久链接（无签名）', icon: 'none', duration: 2000 })
      },
      fail() {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' })
      }
    })
  },

  /**
   * 调用后端 API 刷新 TOS 签名 URL
   * @param {string} conversationId - Coze 会话 ID
   * @param {string} filePattern - 文件基础路径（无签名参数）
   * @param {boolean} isVideo - 是否为视频文件
   */
  _refreshFileUrl(conversationId, filePattern, isVideo) {
    const that = this
    const app = getApp()

    wx.request({
      url: `${app.globalData.apiBase}/api/workflow/refresh-url`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'x-session': app.globalData.token
      },
      data: {
        conversation_id: conversationId,
        file_pattern: filePattern
      },
      timeout: 12000,
      success(res) {
        wx.hideLoading()
        if (res.statusCode === 200 && res.data && res.data.url) {
          // 刷新成功 → 复制新签名 URL
          that._copyLinkToClipboard(res.data.url, isVideo, 'fresh')
        } else {
          // 刷新失败 → 提示原因，不自动复制无签名的 baseUrl（否则浏览器打开会 AccessDenied）
          const errMsg = (res.data && res.data.error) || '刷新失败'
          wx.showModal({
            title: '刷新失败',
            content: errMsg + '。\n\n原始链接可能已过期，请稍后重试。',
            showCancel: false,
            confirmText: '知道了'
          })
        }
      },
      fail() {
        wx.hideLoading()
        // 网络错误 → 不复制可能已过期的 baseUrl，避免用户拿到无效链接
        wx.showModal({
          title: '刷新失败',
          content: '网络连接失败，请稍后重试。',
          showCancel: false,
          confirmText: '知道了',
        })
      }
    })
  },

  /**
   * 复制链接到剪贴板（统一入口）
   * @param {string} url - 要复制的 URL
   * @param {boolean} isVideo - 是否为视频
   * @param {'fresh'|'expired'} status - 链接状态
   */
  _copyLinkToClipboard(url, isVideo, status) {
    const tipContent = isVideo
      ? (status === 'fresh'
          ? '链接已复制到剪贴板，请在浏览器中粘贴打开查看视频'
          : '链接已复制到剪贴板。\n\n⚠️ 注意：链接含临时签名（24小时有效），过期会失效。长按链接可尝试刷新签名。')
      : '链接已复制到剪贴板，请在浏览器中粘贴打开'

    wx.setClipboardData({
      data: url,
      success() {
        wx.showModal({
          title: '链接已复制',
          content: tipContent,
          showCancel: false,
          confirmText: '知道了',
        })
      },
      fail() {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' })
      }
    })
  },

  // 使用教程
  showTutorial() {
    const tutorial = this.data.tool?.tutorial
    if (!tutorial) return

    // 将 HTML 链接标签和换行转换为 rich-text nodes
    const nodes = this.parseTutorialHtml(tutorial)
    this._setData({
      showTutorialModal: true,
      tutorialContent: nodes
    })
  },

  closeTutorial() {
    this._setData({ showTutorialModal: false })
  },

  parseTutorialHtml(html) {
    const nodes = []
    // 按 <a> 和 <br> 标签分割
    const parts = html.split(/(<a\s+href="[^"]*"[^>]*>.*?<\/a>|<br\s*\/?>)/gi)

    for (const part of parts) {
      if (!part) continue

      // 链接
      const linkMatch = part.match(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/i)
      if (linkMatch) {
        nodes.push({
          name: 'a',
          attrs: { href: linkMatch[1] },
          children: [{ type: 'text', text: linkMatch[2] }]
        })
        continue
      }

      // 换行
      if (/<br\s*\/?>/i.test(part)) {
        nodes.push({ name: 'br' })
        continue
      }

      // 纯文本（先反转义）
      const text = part
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')

      // 按 \n 分割纯文本，插入 br
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (i > 0) nodes.push({ name: 'br' })
        if (line) nodes.push({ type: 'text', text: line })
      })
    }

    return nodes
  }
})
