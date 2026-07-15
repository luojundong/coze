/**
 * 小程序端纯 JS 二维码生成器
 * 基于 QR Code Generator (Nayuki) 算法，适配微信小程序 Canvas 2D API
 * 
 * 用法:
 *   const { drawQRCode } = require('./qrcode.js')
 *   drawQRCode(canvas, text, size)
 */

// ==================== QR Code 核心算法 ====================

// 二维码版本信息（版本1-40的数据容量）
const VERSION_INFO = [
  // (totalCodewords, eccCodewordsPerBlock, numBlocks1, dataCodewordsPerBlock1, numBlocks2, dataCodewordsPerBlock2)
  null,
  [26, 7, 1, 19, 0, 0],    // V1
  [44, 10, 1, 34, 0, 0],   // V2
  [70, 15, 1, 55, 0, 0],   // V3
  [100, 20, 1, 80, 0, 0],  // V4
  [134, 26, 1, 108, 0, 0], // V5
  [172, 18, 2, 68, 0, 0],  // V6
  [196, 20, 2, 78, 0, 0],  // V7
  [242, 24, 2, 97, 0, 0],  // V8
  [292, 30, 2, 116, 0, 0], // V9
  [346, 18, 2, 68, 2, 69], // V10
  [404, 20, 4, 81, 0, 0],  // V11
  [466, 24, 4, 92, 0, 0],  // V12
  [532, 26, 4, 107, 0, 0], // V13
  [581, 30, 4, 115, 0, 0], // V14
  [655, 22, 6, 87, 0, 0],  // V15
  [733, 24, 6, 98, 0, 0],  // V16
  [815, 28, 6, 107, 0, 0], // V17
  [901, 30, 6, 120, 0, 0], // V18
  [991, 28, 6, 113, 2, 114], // V19
  [1085, 28, 8, 107, 0, 0],  // V20
]

// Galois Field 256 的指数和对数表
const EXP_TABLE = new Array(256)
const LOG_TABLE = new Array(256)
;(function initGalois() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x
    LOG_TABLE[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 256; i++) {
    EXP_TABLE[i] = EXP_TABLE[i - 255]
  }
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255]
}

function gfPolyMul(p1, p2) {
  const res = new Array(p1.length + p2.length - 1).fill(0)
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      res[i + j] ^= gfMul(p1[i], p2[j])
    }
  }
  return res
}

function getGeneratorPoly(degree) {
  let res = [1]
  for (let i = 0; i < degree; i++) {
    res = gfPolyMul(res, [1, EXP_TABLE[i]])
  }
  return res
}

// ==================== 二维码生成 ====================

function getVersion(text) {
  // 自动选择版本（V1-V10，足够小程序场景使用）
  const len = text.length
  if (len <= 17) return 1
  if (len <= 32) return 2
  if (len <= 53) return 3
  if (len <= 78) return 4
  if (len <= 106) return 5
  if (len <= 134) return 6
  if (len <= 154) return 7
  if (len <= 192) return 8
  if (len <= 230) return 9
  return 10
}

function getAlignmentPatterns(version) {
  if (version === 1) return []
  const num = Math.floor(version / 7) + 2
  const step = (version === 32) ? 26 : Math.floor((version * 4 + num * 2 + 1) / (num * 2 - 2)) * 2
  const res = [6]
  let pos = version * 4 + 10
  for (let i = 1; i < num; i++) {
    res.unshift(pos - step * i)
  }
  return res
}

function getModuleCount(version) {
  return version * 4 + 17
}

function createMatrix(version) {
  const size = getModuleCount(version)
  const matrix = new Array(size)
  for (let i = 0; i < size; i++) {
    matrix[i] = new Array(size).fill(null)
  }
  return matrix
}

// 放置定位图案
function placeFinderPatterns(matrix) {
  const size = matrix.length
  for (let r = -1; r <= 7; r++) {
    if (r + 0 < 0 || r + 0 >= size) continue
    for (let c = -1; c <= 7; c++) {
      if (c + 0 < 0 || c + 0 >= size) continue
      if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
        matrix[r + 0][c + 0] = true
        matrix[r + 0][size - 1 - c] = true
        matrix[size - 1 - r][c + 0] = true
      }
    }
  }
}

// 放置对齐图案
function placeAlignmentPatterns(matrix, patterns) {
  const size = matrix.length
  for (const row of patterns) {
    for (const col of patterns) {
      if (matrix[row][col] !== null) continue
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const val = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0))
          matrix[row + r][col + c] = val
        }
      }
    }
  }
}

// 放置时序图案
function placeTimingPatterns(matrix) {
  const size = matrix.length
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0
    if (matrix[6][i] === null) matrix[6][i] = bit
    if (matrix[i][6] === null) matrix[i][6] = bit
  }
}

// 放置格式信息
function placeFormatInfo(matrix, maskPattern) {
  const size = matrix.length
  const data = (0x1 << 3) | maskPattern  // ECC level L (01), mask pattern
  let bits = data
  let ecc = bits
  for (let i = 0; i < 10; i++) {
    ecc = (ecc << 1) ^ ((ecc >>> 9) * 0x537)
  }
  bits = (bits << 10) | ecc
  bits ^= 0x5412

  // 左上角
  const coords = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ]
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >>> i) & 1) === 1
    matrix[coords[i][0]][coords[i][1]] = bit
    if (i < 8) {
      matrix[size - 1 - i][8] = bit
    } else {
      matrix[8][size - 15 + i] = bit
    }
  }
}

// 生成数据码字
function getDataCodewords(text, version) {
  const dataBits = []
  // 模式指示符: Byte mode (0100)
  dataBits.push(0, 1, 0, 0)
  // 字符计数
  const countBits = version < 10 ? 8 : 16
  const len = text.length
  for (let i = countBits - 1; i >= 0; i--) {
    dataBits.push((len >>> i) & 1)
  }
  // 数据
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i)
    for (let j = 7; j >= 0; j--) {
      dataBits.push((code >>> j) & 1)
    }
  }

  // 填充到码字边界
  const totalBits = VERSION_INFO[version][0] * 8
  while (dataBits.length < totalBits) {
    dataBits.push(0)
    if (dataBits.length % 8 === 0) {
      if (dataBits.length >= totalBits) break
      dataBits.push(1, 1, 1, 0, 1, 1, 0, 0)
      if (dataBits.length >= totalBits) break
      dataBits.push(0, 0, 0, 1, 0, 0, 0, 1)
    }
  }

  // 转换为字节数组
  const codewords = []
  for (let i = 0; i < dataBits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (dataBits[i + j] || 0)
    }
    codewords.push(byte)
  }

  return codewords
}

// 生成纠错码字
function getECCCodewords(data, version) {
  const info = VERSION_INFO[version]
  const numBlocks = info[2] + info[4]
  const eccPerBlock = info[1]
  const genPoly = getGeneratorPoly(eccPerBlock)

  const blocks = []
  let pos = 0
  for (let b = 0; b < info[2]; b++) {
    const block = data.slice(pos, pos + info[3])
    blocks.push(block)
    pos += info[3]
  }
  for (let b = 0; b < info[4]; b++) {
    const block = data.slice(pos, pos + info[5])
    blocks.push(block)
    pos += info[5]
  }

  const eccBlocks = blocks.map(block => {
    const msgPoly = [...block, ...new Array(eccPerBlock).fill(0)]
    for (let i = 0; i < block.length; i++) {
      const factor = msgPoly[i]
      if (factor === 0) continue
      for (let j = 0; j < genPoly.length; j++) {
        msgPoly[i + j] ^= gfMul(genPoly[j], factor)
      }
    }
    return msgPoly.slice(block.length)
  })

  // 交织 ECC
  const ecc = []
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of eccBlocks) {
      ecc.push(block[i])
    }
  }
  return ecc
}

// 掩码模式
function applyMask(matrix, maskPattern) {
  const size = matrix.length
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] !== null && matrix[r][c] !== undefined) {
        // 功能模块不改变
        if (r <= 8 || c <= 8 || r >= size - 8 || c >= size - 8) continue
      }
      let invert = false
      switch (maskPattern) {
        case 0: invert = (r + c) % 2 === 0; break
        case 1: invert = r % 2 === 0; break
        case 2: invert = c % 3 === 0; break
        case 3: invert = (r + c) % 3 === 0; break
        case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break
        case 5: invert = (r * c) % 2 + (r * c) % 3 === 0; break
        case 6: invert = ((r * c) % 2 + (r * c) % 3) % 2 === 0; break
        case 7: invert = ((r + c) % 2 + (r * c) % 3) % 2 === 0; break
      }
      if (matrix[r][c] === null) {
        matrix[r][c] = invert
      } else if (matrix[r][c] !== undefined) {
        matrix[r][c] = invert !== matrix[r][c]
      }
    }
  }
}

function generateQRCode(text) {
  const version = getVersion(text)
  const size = getModuleCount(version)
  const matrix = createMatrix(version)
  const patterns = getAlignmentPatterns(version)

  // 放置功能图案
  placeFinderPatterns(matrix)
  placeAlignmentPatterns(matrix, patterns)
  placeTimingPatterns(matrix)

  // 暗模块
  matrix[size - 8][8] = true

  // 保留格式信息区域
  for (let i = 0; i <= 8; i++) {
    if (matrix[i][8] === null) matrix[i][8] = false
    if (i !== 8 && matrix[8][i] === null) matrix[8][i] = false
  }

  // 生成数据和 ECC
  const data = getDataCodewords(text, version)
  const ecc = getECCCodewords(data, version)
  const allCodewords = [...data, ...ecc]

  // 将码字转换为位
  const bits = []
  for (const cw of allCodewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push((cw >>> i) & 1)
    }
  }

  // 放置数据位（从右下角开始，向上蛇形）
  let bitIndex = 0
  let goingUp = true
  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c = 5  // 跳过垂直时序图案列
    for (let row = 0; row < size; row++) {
      const r = goingUp ? size - 1 - row : row
      for (let dc = 0; dc < 2; dc++) {
        const col = c - dc
        if (col < 0) continue
        if (matrix[r][col] === null) {
          matrix[r][col] = bitIndex < bits.length ? bits[bitIndex] === 1 : false
          bitIndex++
        }
      }
    }
    goingUp = !goingUp
  }

  // 应用掩码（选择 mask 0，最简单）
  applyMask(matrix, 0)
  placeFormatInfo(matrix, 0)

  return { matrix, size }
}

// ==================== Canvas 绘制 ====================

/**
 * 在 Canvas 上绘制二维码
 * @param {Object} canvas - wx.createOffscreenCanvas 或 SelectorQuery 获取的 canvas 节点
 * @param {string} text - 二维码内容
 * @param {number} canvasSize - canvas 尺寸（px），二维码会居中绘制
 * @param {Object} options
 * @param {string} options.fgColor - 前景色，默认 '#000000'
 * @param {string} options.bgColor - 背景色，默认 '#FFFFFF'
 * @param {number} options.padding - 内边距（模块数），默认 2
 */
function drawQRCodeToCanvas(canvas, text, canvasSize, options = {}) {
  const { fgColor = '#000000', bgColor = '#FFFFFF', padding = 2 } = options
  const ctx = canvas.getContext('2d')

  const { matrix, size } = generateQRCode(text)
  const totalSize = size + padding * 2
  const moduleSize = Math.floor(canvasSize / totalSize)
  const offset = Math.floor((canvasSize - totalSize * moduleSize) / 2)

  // 背景
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // 绘制模块
  ctx.fillStyle = fgColor
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(
          offset + (c + padding) * moduleSize,
          offset + (r + padding) * moduleSize,
          moduleSize,
          moduleSize
        )
      }
    }
  }
}

/**
 * 小程序内生成二维码海报
 * 使用传入的 Canvas 节点绘制包含二维码 + 文案的海报图
 * 
 * @param {string} qrText - 二维码内容（小程序路径，如 pages/login/login?ref=xxx）
 * @param {string} title - 海报标题
 * @param {string} subtitle - 副标题
 * @param {Object} canvasNode - Canvas 节点（通过 SelectorQuery 获取）
 * @returns {Promise<string>} 返回临时图片路径
 */
function generateQRPoster(qrText, title, subtitle, canvasNode, options = {}) {
  const { qrImagePath = null } = options
  return new Promise(async (resolve, reject) => {
    const canvasWidth = 600
    const canvasHeight = 900
    const qrSize = 360

    // 如果没有传入 canvasNode，回退到离屏 Canvas
    let canvas, ctx
    let useOffscreen = false

    if (canvasNode && canvasNode.getContext) {
      canvas = canvasNode
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      ctx = canvas.getContext('2d')
    } else {
      // 回退：使用离屏 Canvas（兼容旧调用方式）
      useOffscreen = true
      try {
        canvas = wx.createOffscreenCanvas({
          type: '2d',
          width: canvasWidth,
          height: canvasHeight
        })
        ctx = canvas.getContext('2d')
      } catch (e) {
        console.error('[QRPoster] createOffscreenCanvas failed:', e)
        reject(new Error('当前微信版本过低，不支持海报生成'))
        return
      }
    }

    try {
      // 背景
      const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight)
      gradient.addColorStop(0, '#2563EB')
      gradient.addColorStop(1, '#1D4ED8')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)

      // 白色卡片背景
      const cardX = 30, cardY = 120, cardW = canvasWidth - 60, cardH = canvasHeight - 180
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      const radius = 20
      ctx.moveTo(cardX + radius, cardY)
      ctx.lineTo(cardX + cardW - radius, cardY)
      ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + radius, radius)
      ctx.lineTo(cardX + cardW, cardY + cardH - radius)
      ctx.arcTo(cardX + cardW, cardY + cardH, cardX + cardW - radius, cardY + cardH, radius)
      ctx.lineTo(cardX + radius, cardY + cardH)
      ctx.arcTo(cardX, cardY + cardH, cardX, cardY + cardH - radius, radius)
      ctx.lineTo(cardX, cardY + radius)
      ctx.arcTo(cardX, cardY, cardX + radius, cardY, radius)
      ctx.closePath()
      ctx.fill()

      // 标题
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 32px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(title, canvasWidth / 2, cardY + 50)

      // 副标题
      ctx.fillStyle = '#6B7280'
      ctx.font = '22px sans-serif'
      ctx.fillText(subtitle, canvasWidth / 2, cardY + 90)

      // 绘制二维码（在白色卡片中央）
      const qrX = (canvasWidth - qrSize) / 2
      const qrY = cardY + 120
      if (qrImagePath) {
        // 使用微信小程序码图片（扫码直达小程序，优先）
        let drawnMini = false
        try {
          await new Promise((resolveImg, rejectImg) => {
            const img = canvas.createImage()
            img.onload = () => {
              try {
                ctx.drawImage(img, qrX, qrY, qrSize, qrSize)
                resolveImg(null)
              } catch (e) {
                rejectImg(e)
              }
            }
            img.onerror = (e) => rejectImg(e)
            img.src = qrImagePath
          })
          drawnMini = true
        } catch (e) {
          // 小程序码图片加载失败：降级为本地生成的网页链接二维码（qrText 为网页链接）
          console.warn('[QRPoster] 小程序码加载失败，降级为网页链接二维码:', e)
        }
        if (!drawnMini) {
          ctx.save()
          ctx.translate(qrX, qrY)
          drawQRCodeToCanvas(canvas, qrText, qrSize, { padding: 1 })
          ctx.restore()
        }
      } else {
        ctx.save()
        ctx.translate(qrX, qrY)
        drawQRCodeToCanvas(canvas, qrText, qrSize, { padding: 1 })
        ctx.restore()
      }

      // 底部提示文字
      ctx.fillStyle = '#9CA3AF'
      ctx.font = '20px sans-serif'
      ctx.fillText('长按识别二维码', canvasWidth / 2, qrY + qrSize + 50)
      ctx.fillText('加入AI工具平台', canvasWidth / 2, qrY + qrSize + 80)

      // 底部品牌
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
      ctx.font = '18px sans-serif'
      ctx.fillText('AI工具平台 · 扫码体验', canvasWidth / 2, canvasHeight - 30)

      // 导出为临时图片
      if (useOffscreen) {
        // 离屏 Canvas：使用 canvas.toTempFilePath
        canvas.toTempFilePath({
          fileType: 'jpg',
          quality: 0.9,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => {
            console.error('[QRPoster] toTempFilePath failed:', err)
            reject(err)
          }
        })
      } else {
        // 页面 Canvas：使用 wx.canvasToTempFilePath
        wx.canvasToTempFilePath({
          canvas: canvasNode,
          fileType: 'jpg',
          quality: 0.9,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => {
            console.error('[QRPoster] canvasToTempFilePath failed:', err)
            reject(err)
          }
        })
      }
    } catch (e) {
      console.error('[QRPoster] draw error:', e)
      reject(e)
    }
  })
}

/**
 * 将 base64 图片写入小程序临时文件，返回本地路径（供 canvas.drawImage 使用）
 */
function saveBase64ToTempFile(base64Data, ext = 'png') {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    const filePath = `${wx.env.USER_DATA_PATH}/wxacode_${Date.now()}.${ext}`
    const pure = typeof base64Data === 'string' && base64Data.indexOf(',') >= 0
      ? base64Data.split(',')[1]
      : base64Data
    fs.writeFile({
      filePath,
      data: pure,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 向服务端请求生成微信小程序码。
 * 成功返回本地临时图片路径（扫码直达小程序），任何失败返回 null（由调用方降级为网页链接二维码）。
 */
function fetchMiniProgramQRCode(referralCode, apiBase, token) {
  return new Promise((resolve) => {
    if (!referralCode) {
      console.warn('[wxacode:client] 缺少 referralCode，跳过')
      resolve(null)
      return
    }
    if (!token) {
      console.warn('[wxacode:client] token 为空，无法调用后端接口（需要登录态）')
      resolve(null)
      return
    }
    const header = { 'Content-Type': 'application/json' }
    if (token) header['x-session'] = token
    console.log(`[wxacode:client] 请求生成小程序码 code=${referralCode} apiBase=${apiBase}`)
    wx.request({
      url: `${apiBase}/api/wechat/wxacode`,
      method: 'POST',
      header,
      data: { referralCode, scene: referralCode },
      success: async (res) => {
        try {
          if (res.statusCode === 200 && res.data && res.data.success && res.data.imageBase64) {
            console.log(`[wxacode:client] 成功获取小程序码 base64 长度=${res.data.imageBase64.length}`)
            // 微信 getwxacodeunlimit 返回的是 JPEG 字节，存为 .jpg 与真实格式一致，避免 drawImage 因扩展名不匹配而失败
            const path = await saveBase64ToTempFile(res.data.imageBase64, 'jpg')
            console.log(`[wxacode:client] 小程序码保存至 ${path}`)
            resolve(path)
          } else {
            // 服务端返回 needFallback 或异常，降级
            console.error('[wxacode:client] 服务端返回失败:', {
              statusCode: res.statusCode,
              error: res.data?.error,
              needFallback: res.data?.needFallback,
            })
            resolve(null)
          }
        } catch (e) {
          console.error('[wxacode:client] base64 写入文件失败:', e)
          resolve(null)
        }
      },
      fail: (err) => {
        console.error('[wxacode:client] 网络请求失败:', err)
        resolve(null)
      }
    })
  })
}

module.exports = {
  generateQRCode,
  drawQRCodeToCanvas,
  generateQRPoster,
  saveBase64ToTempFile,
  fetchMiniProgramQRCode
}
