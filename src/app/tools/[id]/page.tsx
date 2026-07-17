'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import { callAuthenticatedApi } from '@/lib/api-client';
import { compressImageFile } from '@/lib/image-compress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send, Loader2, AlertCircle, Bot, User, Zap, Link2, Lock, Unlock, Plus, RotateCcw, Upload, Image as ImageIcon, X, ExternalLink, BookOpen, MessageSquare, Trash2, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * 解析消息内容，将 Markdown 图片语法、裸图片URL、普通URL 转换为可交互元素
 * 支持：
 * - Markdown 图片: ![alt](url) → 可点击的图片
 * - 裸图片URL (.png/.jpg/.jpeg/.gif/.webp/.bmp/.svg结尾) → 可点击的图片
 * - 普通URL → 可点击的链接（新窗口打开）
 */
function parseContent(content: string) {
  const elements: Array<{ type: 'text' | 'image' | 'link'; content: string; url?: string }> = [];

  // 正则：匹配 Markdown 图片 ![alt](url)、Markdown 链接 [text](url)、裸 URL
  const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  // 匹配裸 URL，支持常见图片扩展名，也支持 Coze 返回的带路径参数图片
  const bareUrlRe = /(?<!["'(])(https?:\/\/[^\s<>"')\]]+)/gi;

  // 图片 URL 判断：扩展名匹配 或 包含已知图片域名/路径特征
  const imageExtRe = /\.(png|jpe?g|gif|webp|bmp|svg|ico)(\?.*)?$/i;
  const imageUrlPatterns = [
    /\/\/p9-.*\.byteimg\.com\//,     // 字节跳动图片 CDN
    /\/\/.*\.coze\.(cn|com)\/.*\/image/i,
    /\/\/.*\.volccdn\.com\//,
    /\/\/.*\/tos-.*\//,              // 火山引擎图片
    /\/api\/.*\/image/i,
  ];
  function isImageUrl(url: string): boolean {
    if (imageExtRe.test(url)) return true;
    return imageUrlPatterns.some((re) => re.test(url));
  }

  // 先用占位符替换 Markdown 图片，避免被后续规则重复处理
  type Placeholder = { type: 'image' | 'link'; alt: string; url: string };
  const placeholders: Map<string, Placeholder> = new Map();
  let placeholderIndex = 0;

  let processed = content;

  // Step 1: 提取 Markdown 图片
  processed = processed.replace(mdImageRe, (_match, alt, url) => {
    const key = `__IMG_${placeholderIndex++}__`;
    placeholders.set(key, { type: 'image', alt, url });
    return key;
  });

  // Step 2: 提取 Markdown 链接（排除已经是图片的）
  processed = processed.replace(mdLinkRe, (_match, text, url) => {
    const key = `__LINK_${placeholderIndex++}__`;
    // 如果链接指向的是图片 URL，当作图片处理
    const isImage = isImageUrl(url);
    placeholders.set(key, { type: isImage ? 'image' : 'link', alt: text, url });
    return key;
  });

  // Step 3: 提取裸 URL，判断是否为图片
  processed = processed.replace(bareUrlRe, (url) => {
    const key = `__URL_${placeholderIndex++}__`;
    const isImage = isImageUrl(url);
    placeholders.set(key, { type: isImage ? 'image' : 'link', alt: url, url });
    return key;
  });

  // Step 4: 按占位符分割文本，生成最终元素列表
  const placeholderRe = /__((?:IMG|LINK|URL)_\d+)__/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = placeholderRe.exec(processed)) !== null) {
    // 占位符前的纯文本
    if (match.index > lastIndex) {
      const text = processed.slice(lastIndex, match.index);
      if (text) elements.push({ type: 'text', content: text });
    }

    // 占位符对应的元素
    const placeholder = placeholders.get(match[0]);
    if (placeholder) {
      elements.push({
        type: placeholder.type,
        content: placeholder.alt,
        url: placeholder.url,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // 剩余纯文本
  if (lastIndex < processed.length) {
    elements.push({ type: 'text', content: processed.slice(lastIndex) });
  }

  // 如果没有解析出任何元素，返回原始文本
  if (elements.length === 0) {
    elements.push({ type: 'text', content });
  }

  return elements;
}

/**
 * 消息内容渲染组件
 * 将文本中的图片链接和普通链接渲染为可交互元素
 */
function MessageContent({ content }: { content: string }) {
  const elements = useMemo(() => parseContent(content), [content]);

  return (
    <>
      {elements.map((el, i) => {
        if (el.type === 'image' && el.url) {
          return (
            <span key={i} className="block my-2">
              <a
                href={el.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group relative"
                title="点击查看原图"
              >
                <img
                  src={el.url}
                  alt={el.content}
                  className="max-w-full max-h-64 rounded-lg border border-gray-200 object-contain bg-gray-50 cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  onClick={(e) => {
                    // 阻止默认行为，直接在新窗口打开
                    e.preventDefault();
                    window.open(el.url, '_blank', 'noopener,noreferrer');
                  }}
                />
                <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                  <ExternalLink className="h-3 w-3" />
                  查看原图
                </span>
              </a>
              {el.content && el.content !== el.url && (
                <span className="text-xs text-gray-400 block mt-0.5">{el.content}</span>
              )}
            </span>
          );
        }
        if (el.type === 'link' && el.url) {
          return (
            <a
              key={i}
              href={el.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline break-all"
              title={el.url}
            >
              {el.content || el.url}
            </a>
          );
        }
        return <span key={i}>{el.content}</span>;
      })}
    </>
  );
}

interface ParamPreset {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea' | 'image' | 'audio' | 'video';
  defaultValue?: string;
  required?: boolean;
}

interface ToolConfig {
  id: string;
  coze_id: string;
  name: string;
  description: string;
  type: string;
  is_enabled: boolean;
  is_activated: boolean;
  coze_connected: boolean;
  bot_available?: boolean;
  bot_info?: {
    prompt?: string;
    opening_statement?: string;
    suggested_questions?: string[];
  };
  parameters_schema?: ParamPreset[] | null;
  tutorial?: string | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface Conversation {
  id: string;
  coze_conversation_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// 媒体参数输入组件：支持URL输入 + 本地上传（图片/音频/视频）
function MediaParamInput({
  value,
  placeholder,
  onChange,
  mediaType = 'image',
}: {
  value: string;
  placeholder: string;
  onChange: (val: string) => void;
  onUploading?: (uploading: boolean) => void;
  mediaType?: 'image' | 'audio' | 'video';
}) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [inputMode, setInputMode] = useState<'url' | 'upload'>('url');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步外部value变化
  useEffect(() => {
    if (value && value !== previewUrl) {
      setPreviewUrl(value);
    }
  }, [value]);

  const acceptMap: Record<string, string> = {
    image: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
    audio: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a,audio/webm,audio/flac',
    video: 'video/mp4,video/webm,video/ogg,video/quicktime',
  };
  const maxSizeMap: Record<string, number> = {
    image: 10 * 1024 * 1024,
    audio: 50 * 1024 * 1024,
    video: 100 * 1024 * 1024,
  };
  const typeLabelMap: Record<string, string> = { image: '图片', audio: '音频', video: '视频' };
  const typeLabel = typeLabelMap[mediaType] || '文件';

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验类型和大小
    const acceptPrefix = mediaType === 'image' ? 'image/' : mediaType === 'audio' ? 'audio/' : 'video/';
    if (!file.type.startsWith(acceptPrefix)) {
      alert(`请选择${typeLabel}文件`);
      return;
    }
    const maxSize = maxSizeMap[mediaType] || 10 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`${typeLabel}大小不能超过${Math.round(maxSize / 1024 / 1024)}MB`);
      return;
    }

    setUploading(true);
    try {
      // 图片在上传前先压缩，避免原图过大导致 Coze 工作流下载图片链接超时
      const fileToUpload = mediaType === 'image' ? await compressImageFile(file) : file;
      if (fileToUpload !== file) {
        console.log(`[MediaUpload] 图片已压缩: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
      }

      const formData = new FormData();
      formData.append('file', fileToUpload);

      const res = await callAuthenticatedApi('/api/upload/media', {
        method: 'POST',
        body: formData,
        timeout: 120000,  // 上传文件 120 秒超时
      } as RequestInit & { timeout?: number });

      if (!res) throw new Error('请求失败');
      // 先检查 HTTP 状态码，再尝试解析 JSON（避免解析 500 HTML 页面报 "Internal S" 错误）
      if (!res.ok) {
        let errorMsg = '上传失败';
        try {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          errorMsg = `服务器错误 (${res.status})，请稍后重试`;
        }
        throw new Error(errorMsg);
      }
      const data = await res.json();

      const uploadedUrl = data.url;
      setPreviewUrl(uploadedUrl);
      onChange(uploadedUrl);
      console.log(`[MediaUpload] Uploaded ${mediaType}:`, uploadedUrl);
    } catch (err: any) {
      alert(err.message || `${typeLabel}上传失败，请重试`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUrlChange = (url: string) => {
    setPreviewUrl(url);
    onChange(url);
  };

  return (
    <div>
      {/* 模式切换 */}
      <div className="flex gap-1 mb-1.5">
        <button
          type="button"
          onClick={() => setInputMode('url')}
          className={`text-xs px-2 py-0.5 rounded ${inputMode === 'url' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Link2 className="h-3 w-3 inline mr-0.5" />链接
        </button>
        <button
          type="button"
          onClick={() => setInputMode('upload')}
          className={`text-xs px-2 py-0.5 rounded ${inputMode === 'upload' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Upload className="h-3 w-3 inline mr-0.5" />上传
        </button>
      </div>

      {inputMode === 'url' ? (
        <input
          type="text"
          value={value}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      ) : (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptMap[mediaType]}
            onChange={handleUpload}
            className="hidden"
          />
          {value ? (
            // 已上传预览 - 根据类型显示不同预览
            <div className="relative group rounded-md overflow-hidden border border-gray-200 bg-gray-50">
              {mediaType === 'image' ? (
                <img
                  src={value}
                  alt="预览"
                  className="w-full h-24 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : mediaType === 'audio' ? (
                <div className="w-full p-3 flex items-center gap-2">
                  <span className="text-2xl">🎵</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">音频文件已上传</p>
                    <audio controls className="w-full mt-1 h-8" src={value}>
                      您的浏览器不支持音频播放
                    </audio>
                  </div>
                </div>
              ) : (
                <div className="w-full p-3 flex items-center gap-2">
                  <span className="text-2xl">🎬</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">视频文件已上传</p>
                    <video controls className="w-full mt-1 max-h-32 rounded" src={value}>
                      您的浏览器不支持视频播放
                    </video>
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 text-gray-700 rounded-md px-2 py-1 text-xs font-medium"
                >
                  更换{typeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => { setPreviewUrl(''); onChange(''); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/90 text-white rounded-md px-2 py-1 text-xs font-medium"
                >
                  移除
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full px-2.5 py-3 border-2 border-dashed border-gray-300 rounded-md text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex flex-col items-center gap-1 bg-gray-50/50 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-xs">上传中...</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">{placeholder || `点击上传${typeLabel}文件`}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* 预览缩略图 (URL模式) */}
      {inputMode === 'url' && value && value.startsWith('http') && (
        <div className="mt-1.5 relative">
          {mediaType === 'image' ? (
            <img
              src={value}
              alt="预览"
              className="w-full h-16 object-cover rounded-md border border-gray-200"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : mediaType === 'audio' ? (
            <audio controls className="w-full h-8" src={value}>
              您的浏览器不支持音频播放
            </audio>
          ) : (
            <video controls className="w-full max-h-32 rounded-md border border-gray-200" src={value}>
              您的浏览器不支持视频播放
            </video>
          )}
          <button
            type="button"
            onClick={() => { setPreviewUrl(''); onChange(''); }}
            className="absolute top-0.5 right-0.5 bg-gray-800/60 text-white rounded-full p-0.5 hover:bg-gray-800/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ToolDetailPage() {
  const params = useParams();
  const [toolId, setToolId] = useState<string>('');
  const [tool, setTool] = useState<ToolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [cozeConnected, setCozeConnected] = useState(false);

  // Conversation history state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Activation state
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Workflow state
  const [workflowInput, setWorkflowInput] = useState('');
  const [workflowResult, setWorkflowResult] = useState('');
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);

  // 快捷输入参数表单状态
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [showParamForm, setShowParamForm] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract toolId from params
  useEffect(() => {
    if (params?.id) {
      const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';
      if (id) setToolId(id);
    }
  }, [params]);

  // 关键修复：切换工具（toolId 变化）时重置对话与会话状态。
  // Next.js 在同一动态路由 /tools/[id] 之间切换时不会卸载组件，
  // 若不重置，上一个工具的 conversation_id 会被带入新工具；
  // 而 Coze 的 conversation 绑定到特定 bot，跨 bot 复用会报 "Request parameter error"。
  useEffect(() => {
    setMessages([]);
    setConversationId('');
    setCurrentConversationId(null);
    setInputValue('');
    setParamValues({});
    setWorkflowInput('');
    setWorkflowResult('');
    setIsSending(false);
    setIsRunningWorkflow(false);
  }, [toolId]);

  // Fetch tool info
  useEffect(() => {
    if (!toolId) return;
    const fetchTool = async () => {
      try {
        setLoading(true);
        const res = await callAuthenticatedApi(`/api/tools/${toolId}`);
        if (!res) { setError('请求失败'); return; }
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '加载工具失败');
          return;
        }
        const t = data.tool as ToolConfig & {
          opening_statement?: string;
          prompt_info?: string;
          suggested_questions?: string[];
          bot_available?: boolean;
        };
        // 解析 parameters_schema
        const rawSchema = data.tool?.parameters_schema;
        const paramSchema: ParamPreset[] | null = Array.isArray(rawSchema) ? rawSchema : null;
        setTool({
          ...t,
          is_activated: t.is_activated ?? false,
          coze_connected: data.coze_connected ?? false,
          bot_available: t.bot_available !== false,
          bot_info: {
            opening_statement: t.opening_statement ?? undefined,
            prompt: t.prompt_info ?? undefined,
            suggested_questions: t.suggested_questions ?? undefined,
          },
          parameters_schema: paramSchema,
        });
        setCozeConnected(data.coze_connected ?? false);

        // Show opening statement as system message (only if activated)
        if (t.type === 'bot' && t.opening_statement && (t.is_activated ?? false)) {
          setMessages([{
            id: 'opening',
            role: 'system',
            content: t.opening_statement,
            timestamp: new Date(),
          }]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchTool();
  }, [toolId]);

  // 检测从 Coze OAuth 回调回来，自动刷新连接状态
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const hasOAuthParams = urlParams.has('code') || urlParams.has('error') || urlParams.has('state');
      if (hasOAuthParams) {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        // 延迟一下等 OAuth 回调处理完成，然后刷新工具信息
        const timer = setTimeout(async () => {
          try {
            const res = await callAuthenticatedApi(`/api/tools/${toolId}`);
            if (res && res.ok) {
              const data = await res.json();
              setCozeConnected(data.coze_connected ?? false);
            }
          } catch { /* ignore */ }
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [toolId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ===== 对话记录：加载对话列表 =====
  useEffect(() => {
    if (!toolId || tool?.type !== 'bot') return;
    fetchConversations();
  }, [toolId, tool?.type]);

  const fetchConversations = async () => {
    try {
      const res = await callAuthenticatedApi(`/api/conversations?tool_id=${toolId}`);
      if (res && res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch { /* ignore */ }
  };

  const loadConversation = async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await callAuthenticatedApi(`/api/conversations/${convId}`);
      if (res && res.ok) {
        const data = await res.json();
        const conv = data.conversation;
        if (conv && conv.messages) {
          const msgs: ChatMessage[] = conv.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at),
          }));
          setMessages(msgs);
          setCurrentConversationId(convId);
          setConversationId(conv.coze_conversation_id || '');
        }
      }
    } catch (err) {
      console.error('加载对话失败:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setConversationId('');
    setCurrentConversationId(null);
    setInputValue('');
    // 显示开场白
    if (tool?.type === 'bot' && tool.bot_info?.opening_statement) {
      setMessages([{
        id: 'opening',
        role: 'system',
        content: tool.bot_info.opening_statement,
        timestamp: new Date(),
      }]);
    }
  };

  const saveConversationMessages = async (msgs: ChatMessage[], cozeConvId?: string) => {
    if (msgs.length === 0) return null;
    try {
      // 创建或获取对话
      let convId = currentConversationId;
      if (!convId) {
        const createRes = await callAuthenticatedApi('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool_id: toolId,
            coze_conversation_id: cozeConvId || conversationId || undefined,
          }),
        });
        if (createRes && createRes.ok) {
          const data = await createRes.json();
          convId = data.conversation?.id;
          if (convId) setCurrentConversationId(convId);
        }
      } else if (cozeConvId) {
        // 更新 coze_conversation_id
        await callAuthenticatedApi('/api/conversations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: convId, coze_conversation_id: cozeConvId }),
        });
      }

      if (convId) {
        // 保存消息（全量替换）
        const msgPayload = msgs
          .filter(m => m.role !== 'system') // 不保存系统消息（开场白）
          .map((m, i) => ({
            role: m.role,
            content: m.content,
            content_type: 'text',
            sort_order: i,
          }));

        if (msgPayload.length > 0) {
          await callAuthenticatedApi(`/api/conversations/${convId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: msgPayload, replace: true }),
          });
          // 刷新列表
          fetchConversations();
        }
      }
    } catch (err) {
      console.error('保存对话失败:', err);
    }
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这条对话记录吗？')) return;
    try {
      const res = await callAuthenticatedApi(`/api/conversations/${convId}`, {
        method: 'DELETE',
      });
      if (res && res.ok) {
        setConversations(prev => prev.filter(c => c.id !== convId));
        if (currentConversationId === convId) {
          startNewChat();
        }
      }
    } catch { /* ignore */ }
  };

  // ===== 页面可见性检测：防止切换标签页/后台导致 SSE 连接断开后内容丢失 =====
  // 在 sessionStorage 中备份当前会话状态，页面重新可见时恢复
  const visibilityBackupRef = useRef(false);
  useEffect(() => {
    if (!toolId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面即将隐藏（切换标签页、锁屏等），备份当前状态
        if (isSending) {
          visibilityBackupRef.current = true;
          try {
            sessionStorage.setItem(`tool_chat_${toolId}`, JSON.stringify({
              messages,
              conversationId,
              timestamp: Date.now(),
            }));
          } catch { /* sessionStorage 满时忽略 */ }
        }
      } else if (document.visibilityState === 'visible' && visibilityBackupRef.current) {
        // 页面重新可见，且之前有进行中的任务
        visibilityBackupRef.current = false;
        // 如果 messages 在恢复过程中被清空，尝试从 sessionStorage 恢复
        try {
          const backup = sessionStorage.getItem(`tool_chat_${toolId}`);
          if (backup) {
            const { messages: backedUpMessages, conversationId: backedUpConvId, timestamp } = JSON.parse(backup);
            // 只恢复 5 分钟内的备份
            if (Date.now() - timestamp < 5 * 60 * 1000) {
              // 当前消息比备份少 → 可能丢失了，恢复备份
              if (messages.length < backedUpMessages.length) {
                setMessages(backedUpMessages);
              }
              if (backedUpConvId && !conversationId) {
                setConversationId(backedUpConvId);
              }
            }
            sessionStorage.removeItem(`tool_chat_${toolId}`);
          }
        } catch { /* ignore */ }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // 也监听 pagehide（iOS Safari 切换到后台时可能不触发 visibilitychange）
    window.addEventListener('pagehide', () => {
      if (isSending) {
        try {
          sessionStorage.setItem(`tool_chat_${toolId}`, JSON.stringify({
            messages,
            conversationId,
            timestamp: Date.now(),
          }));
        } catch { /* ignore */ }
      }
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', () => {});
    };
  }, [toolId, messages, conversationId, isSending]);

  // ===== 页面加载时尝试从 sessionStorage 恢复上次未完成的任务 =====
  useEffect(() => {
    if (!toolId) return;
    try {
      const backup = sessionStorage.getItem(`tool_chat_${toolId}`);
      if (backup) {
        const { messages: backedUpMessages, conversationId: backedUpConvId, timestamp } = JSON.parse(backup);
        // 只恢复 5 分钟内的备份
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          if (backedUpMessages && backedUpMessages.length > 0) {
            // 检查最后一条消息是否是 streaming 状态（未完成）
            const lastMsg = backedUpMessages[backedUpMessages.length - 1];
            if (lastMsg && lastMsg.isStreaming) {
              // 标记为已完成，避免显示 loading 动画
              backedUpMessages[backedUpMessages.length - 1] = {
                ...lastMsg,
                isStreaming: false,
                content: lastMsg.content || '任务已中断，请重新发送消息。',
              };
            }
            setMessages(backedUpMessages);
          }
          if (backedUpConvId) setConversationId(backedUpConvId);
        }
        sessionStorage.removeItem(`tool_chat_${toolId}`);
      }
    } catch { /* ignore */ }
  }, [toolId]);

  // Generate unique ID
  const genId = () => Math.random().toString(36).substring(2, 10);

  // Handle activation
  const handleActivate = async () => {
    if (!activationCode.trim()) {
      setActivationError('请输入激活码');
      return;
    }
    setActivating(true);
    setActivationError('');
    try {
      const res = await callAuthenticatedApi('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode.trim() }),
      });
      if (!res) {
        setActivationError('请先登录');
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setActivationSuccess(true);
        // Update tool activation status
        setTool(prev => prev ? { ...prev, is_activated: true } : prev);
        // Show opening statement if available
        if (tool?.bot_info?.opening_statement && messages.length === 0) {
          setMessages([{
            id: 'opening',
            role: 'system',
            content: tool.bot_info.opening_statement,
            timestamp: new Date(),
          }]);
        }
        setTimeout(() => {
          setActivationSuccess(false);
          setActivationCode('');
        }, 1500);
      } else {
        setActivationError(data.error || '激活失败');
      }
    } catch {
      setActivationError('激活失败，请重试');
    } finally {
      setActivating(false);
    }
  };

  // Send message for bot chat（混合架构：优先 SSE 流式 → 降级异步轮询）
  const handleSendChat = useCallback(async (messageText?: string) => {
    const text = (messageText || inputValue).trim();
    if (!text || isSending) return;

    // Check activation
    if (!tool?.is_activated) return;

    setInputValue('');
    setIsSending(true);

    // Add user message
    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Add streaming assistant placeholder
    const assistantId = genId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMsg]);

    // 保存 taskId 用于降级轮询
    let taskIdForFallback: string | null = null;

    try {
      // SSE 流式调用：不设超时（timeout=0），依赖 SSE 自身的超时检测机制
      const res = await callAuthenticatedApi('/api/workflow/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_id: toolId,
          parameters: { input: text },
          conversation_id: conversationId || undefined,
        }),
        timeout: 0,
      } as RequestInit & { timeout?: number });

      if (!res) throw new Error('请求失败');

      // Check if response is an error (not SSE)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errData = await res.json();
        if (errData.needCozeAuth) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: '请先连接您的 Coze 账户。若管理员已配置平台 Token，连接后将自动使用。', isStreaming: false }
              : m
          ));
          return;
        }
        if (errData.needActivation) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: '此工具需要激活码，请先激活后再使用。', isStreaming: false }
              : m
          ));
          setTool(prev => prev ? { ...prev, is_activated: false } : prev);
          return;
        }
        // 图像流并发限制 → 友好提示（不抛异常）
        if (errData.retryable) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: errData.error || '当前使用人数较多，请稍后重试', isStreaming: false }
              : m
          ));
          return;
        }
        throw new Error(errData.error || '调用失败');
      }

      // ========== SSE 流式读取（优先路径） ==========
      // 安全检查：如果 response body 不可读，尝试用 text() 兜底
      if (!res.body) {
        console.warn('[SSE] Response has no body, trying text() fallback');
        try {
          const fallbackText = await res.text();
          if (fallbackText) {
            // 尝试解析 SSE 格式
            const lines = fallbackText.split('\n');
            let fallbackContent = '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const d = JSON.parse(dataStr);
                    if (d.type === 'answer' && d.content) {
                      fallbackContent += d.content;
                    }
                  } catch { /* skip */ }
                }
              }
            }
            if (fallbackContent) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: fallbackContent, isStreaming: false } : m
              ));
              return;
            }
          }
        } catch { /* ignore */ }
        throw new Error('响应流不可用，请稍后重试');
      }
      const reader = res.body.getReader();

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let accumulatedContent = '';
      let lastChunkTime = Date.now();
      let sseFailed = false;

      const SSE_TIMEOUT = 60000;  // 60 秒无数据判定 SSE 异常（音频/视频生成需要更长时间）

      while (!sseFailed) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          // 带超时的 read
          const readPromise = reader.read();
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('sse_read_timeout')), 60000)
          );
          readResult = await Promise.race([readPromise, timeoutPromise]);
        } catch (e: any) {
          if (e.message === 'sse_read_timeout') {
            sseFailed = true;
            break;
          }
          throw e;
        }

        if (readResult.done) break;

        lastChunkTime = Date.now();

        buffer += decoder.decode(readResult.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              // ===== 捕获服务端 task_id（用于降级轮询直接查询状态） =====
              if (currentEvent === 'task_id' && data.task_id) {
                taskIdForFallback = data.task_id;
                console.log('[SSE] Captured server task_id for fallback:', taskIdForFallback);
                continue;
              }

              // Handle conversation.message.delta — incremental content
              if (currentEvent === 'conversation.message.delta' && data.type === 'answer' && data.content) {
                accumulatedContent += data.content;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: accumulatedContent } : m
                ));
              }

              // Handle conversation.message.completed — full message
              if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
                if (!accumulatedContent) {
                  accumulatedContent = data.content;
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: accumulatedContent } : m
                  ));
                }
              }

              // Capture conversation_id AND taskId (from stream route headers)
              if (data.conversation_id && !conversationId) {
                setConversationId(data.conversation_id);
              }

              // Handle chat failed
              if (currentEvent === 'conversation.chat.failed') {
                const le = data.last_error || {};
                const leDetail = le.code
                  ? `[${le.code}${le.param ? ':' + le.param : ''}] ${le.msg || le.message || '对话失败'}`
                  : (le.msg || le.message || '对话失败，请重试');
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: leDetail, isStreaming: false }
                    : m
                ));
                setIsSending(false);
                return;
              }

              // Handle error event
              if (currentEvent === 'error' || data.error_code) {
                const errMsg = data.error_message || data.msg || data.last_error?.msg || '调用出错';
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: `错误: ${errMsg}`, isStreaming: false }
                    : m
                ));
                setIsSending(false);
                return;
              }

              // ===== 识别 Coze Token 错误（即使是 SSE 包装后，前端也要正确引导用户） =====
              if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
                const lc = data.content.toLowerCase();
                if (lc.includes('token you entered is incorrect') ||
                    lc.includes('unauthorized') ||
                    lc.includes('authentication') ||
                    (data.content.includes('Coze Token') && data.content.includes('失效'))) {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: data.content, isStreaming: false }
                      : m
                  ));
                  setCozeConnected(false);  // 触发前端 Coze 重新连接提示
                  setIsSending(false);
                  return;
                }
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        }
      }

      if (sseFailed) {
        // ========== SSE 异常 → 降级轮询异步任务 ==========
        // 优先复用 SSE 流注入的 taskId（避免重复创建任务浪费积分）
        try {
          // 检查是否有 taskIdForFallback（从 SSE task_id 事件捕获）
          if (!taskIdForFallback) {
            // 没有复用 taskId → 创建新任务
            const taskRes = await callAuthenticatedApi('/api/workflow/task/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tool_id: toolId,
                parameters: { input: text },
                conversation_id: conversationId || undefined,
              }),
              timeout: 15000,
            } as RequestInit & { timeout?: number });

            if (taskRes) {
              const taskData = await taskRes.json();
              taskIdForFallback = taskData.taskId;
            }
          }

          if (taskIdForFallback) {
            // 轮询等待结果
            const MAX_POLLS = 120;  // 120 × 2s = 240s（音频/视频生成需要更长时间）
            for (let i = 0; i < MAX_POLLS; i++) {
              await new Promise(r => setTimeout(r, 2000));

              try {
                const pollRes = await callAuthenticatedApi(
                  `/api/workflow/task/status?taskId=${taskIdForFallback}`,
                  { timeout: 10000 } as RequestInit & { timeout?: number }
                );
                if (!pollRes) continue;

                const pollData = await pollRes.json();

                // 实时显示增量内容（chunk 字段）
                if (pollData.chunk && pollData.status === 'running') {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: pollData.chunk, isStreaming: true } : m
                  ));
                }

                if (pollData.status === 'completed') {
                  const content = pollData.result?.output || pollData.chunk || '智能体已回复';
                  setMessages(prev => {
                    const updated = prev.map(m =>
                      m.id === assistantId ? { ...m, content, isStreaming: false } : m
                    );
                    saveConversationMessages(updated, pollData.result?.conversation_id);
                    return updated;
                  });
                  if (pollData.result?.conversation_id) {
                    setConversationId(pollData.result.conversation_id);
                  }
                  return;
                }

                if (pollData.status === 'failed') {
                  throw new Error(pollData.error || '智能体执行失败');
                }
              } catch (pollErr: any) {
                // 后端明确返回失败 → 立即停止
                const errMsg = pollErr?.message || '';
                if (errMsg.includes('智能体执行失败') || errMsg.includes('网络连接不稳定') ||
                    errMsg.includes('智能体服务异常') || errMsg.includes('智能体响应超时') ||
                    errMsg.includes('图像处理节点排队拥挤')) {
                  throw pollErr;
                }
                // 网络抖动 → 继续重试
                console.warn(`Fallback poll ${i + 1} error:`, errMsg);
              }
            }
            throw new Error('智能体响应超时，请稍后重试');
          }
        } catch (fallbackErr: any) {
          const msg = fallbackErr?.message || '发送失败';
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: `发送失败: ${msg}`, isStreaming: false } : m
          ));
          return;
        }
      }

      // Mark streaming as done
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === assistantId
            ? { ...m, content: accumulatedContent || '未收到回复，请检查 Coze 账户连接或重试。', isStreaming: false }
            : m
        );
        saveConversationMessages(updated);
        return updated;
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : '发送失败';
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === assistantId ? { ...m, content: `发送失败: ${msg}`, isStreaming: false } : m
        );
        saveConversationMessages(updated);
        return updated;
      });
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [inputValue, isSending, toolId, conversationId, tool?.is_activated, currentConversationId]);

  // Run workflow (non-streaming)
  const handleRunWorkflow = useCallback(async (params?: Record<string, string>) => {
    if (isRunningWorkflow) return;
    if (!tool?.is_activated) return;

    // 未传参时回退到普通输入框
    const bodyParams = params && Object.keys(params).length > 0
      ? params
      : workflowInput.trim()
        ? { input: workflowInput.trim() }
        : null;
    if (!bodyParams) return;

    setIsRunningWorkflow(true);
    setWorkflowResult('');

    try {
      const res = await callAuthenticatedApi('/api/workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_id: toolId,
          parameters: bodyParams,
        }),
      });

      if (!res) throw new Error('请求失败');
      const data = await res.json();

      if (data.needCozeAuth) {
        setWorkflowResult('请先连接您的 Coze 账户。');
        return;
      }

      if (data.needActivation) {
        setWorkflowResult('此工具需要激活码，请先激活后再使用。');
        setTool(prev => prev ? { ...prev, is_activated: false } : prev);
        return;
      }

      if (!res.ok) {
        const errorMsg = data.error || '执行失败';
        // 图像流并发限制 → 友好提示
        if (data.retryable) {
          setWorkflowResult(errorMsg);
          return;
        }
        throw new Error(errorMsg);
      }
      setWorkflowResult(typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2));
    } catch (err) {
      setWorkflowResult(`执行失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsRunningWorkflow(false);
    }
  }, [workflowInput, isRunningWorkflow, toolId, tool?.is_activated]);

  // Handle Coze connect
  const handleConnectCoze = async () => {
    try {
      const res = await callAuthenticatedApi('/api/coze/oauth/authorize');
      if (!res) { alert('请先登录'); return; }
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        alert(data.error || '获取授权链接失败');
      }
    } catch {
      alert('连接 Coze 失败，请重试');
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Error state
  if (error || !tool) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">{error || '工具不存在'}</p>
          <Link href="/tools">
            <Button variant="outline">返回工具列表</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isBot = tool.type === 'bot';
  const isActivated = tool.is_activated;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href="/tools" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">{tool.name}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {tool.tutorial && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowTutorial(true)}
              className="text-xs h-7 whitespace-nowrap"
            >
              <BookOpen className="h-3 w-3 mr-1" /> 使用教程
            </Button>
          )}
          {isBot && isActivated && (
            cozeConnected ? (
              <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-600 flex items-center gap-1 whitespace-nowrap">
                <Zap className="h-3 w-3" /> Coze 已连接
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-600 flex items-center gap-1 whitespace-nowrap">
                <AlertCircle className="h-3 w-3" /> Coze 未连接
              </span>
            )
          )}
        </div>
      </div>

      {/* Not activated - show activation panel */}
      {!isActivated && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border shadow-sm w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="h-7 w-7 text-gray-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">工具未激活</h2>
            <p className="text-sm text-gray-500 mb-5">此工具需要激活码才能使用，请输入您获取的激活码</p>
            {activationSuccess ? (
              <div className="py-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Unlock className="h-6 h-6 text-green-600" />
                </div>
                <p className="text-green-700 font-medium">激活成功！</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <input
                    type="text"
                    value={activationCode}
                    onChange={(e) => { setActivationCode(e.target.value); setActivationError(''); }}
                    placeholder="请输入激活码"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                    autoFocus
                  />
                  {activationError && (
                    <p className="text-red-500 text-xs mt-1.5">{activationError}</p>
                  )}
                </div>
                <button
                  onClick={handleActivate}
                  disabled={activating || !activationCode.trim()}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >{activating ? '激活中...' : '激活'}</button>
              </>
            )}
            <Link href="/tools" className="text-sm text-gray-500 hover:text-gray-700 mt-4 inline-block">
              ← 返回工具列表
            </Link>
          </div>
        </div>
      )}

      {/* Activated - show chat/workflow */}
      {isActivated && isBot ? (
        /* ========== Bot Chat Mode ========== */
        <>
          {/* Bot not available — distinguish between Coze not connected vs truly unavailable */}
          {tool.bot_available === false && !cozeConnected ? (
            /* Coze 未连接导致智能体不可用 → 引导用户连接 */
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">Coze 账户未连接或 Token 已过期，请先完成 Coze 授权后再使用对话功能。</span>
              <Button size="sm" variant="outline" onClick={handleConnectCoze} className="text-xs h-7 border-red-300 text-red-700 hover:bg-red-100 whitespace-nowrap">
                <Link2 className="h-3 w-3 mr-1" /> 连接 Coze
              </Button>
            </div>
          ) : tool.bot_available === false ? (
            /* 真正智能体未发布 */
            <div className="bg-red-50 border-b px-4 py-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>该智能体暂未发布或无法访问，暂时无法使用对话功能。请联系管理员确认智能体状态。</span>
            </div>
          ) : !cozeConnected && (
            /* Coze 未连接但智能体本身可用 */
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">Coze 账户未连接，请先完成 Coze 授权后再使用对话功能。</span>
              <Button size="sm" variant="outline" onClick={handleConnectCoze} className="text-xs h-7 border-red-300 text-red-700 hover:bg-red-100 whitespace-nowrap">
                <Link2 className="h-3 w-3 mr-1" /> 连接 Coze
              </Button>
            </div>
          )}

          {/* Chat Messages */}

          {/* Main content: Sidebar + Chat */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* ===== Conversation Sidebar ===== */}
            <div className={`${sidebarOpen ? 'w-64' : 'w-0'} border-r bg-gray-50 flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}>
              <div className="p-3 border-b bg-white">
                <button
                  onClick={startNewChat}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" /> 新对话
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {conversations.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">暂无对话记录</p>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => loadConversation(conv.id)}
                      className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors ${
                        currentConversationId === conv.id
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-gray-200 text-gray-700'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="flex-1 truncate">{conv.title || '新对话'}</span>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity shrink-0"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              {/* 24小时提示 */}
              <div className="p-2 border-t bg-gray-50">
                <p className="text-[10px] text-gray-400 text-center">对话记录保留 24 小时</p>
              </div>
            </div>

            {/* Sidebar toggle button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border rounded-r-md px-0.5 py-2 text-gray-400 hover:text-gray-600 shadow-sm shrink-0"
              style={{ left: sidebarOpen ? '256px' : '0' }}
              title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
            >
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>

            {/* Chat area */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {loadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : (
                <>
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Tool description (messages empty) */}
            {tool.description && messages.length <= 1 && (
              <div className="text-center text-sm text-gray-500 mb-4 max-w-md mx-auto">
                {tool.description}
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
                {msg.role === 'system' ? (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 max-w-lg text-sm text-blue-800">
                    <MessageContent content={msg.content} />
                  </div>
                ) : (
                  <div className={`flex gap-2 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-200'
                    }`}>
                      {msg.role === 'user'
                        ? <User className="h-4 w-4 text-white" />
                        : <Bot className="h-4 w-4 text-gray-600" />
                      }
                    </div>
                    <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-900'
                    }`}>
                      {msg.content && !msg.isStreaming ? (
                        <MessageContent content={msg.content} />
                      ) : msg.isStreaming && msg.content ? (
                        <>
                          {msg.content}
                          <span className="inline-block w-0.5 h-4 bg-blue-600 animate-pulse ml-0.5 align-text-bottom" />
                        </>
                      ) : msg.isStreaming ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          思考中...
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested Questions */}
          {tool.bot_info?.suggested_questions && tool.bot_info.suggested_questions.length > 0 && messages.length <= 1 && (
            <div className="px-4 py-2 border-t bg-white">
              <div className="text-xs text-gray-500 mb-2">推荐问题：</div>
              <div className="flex flex-wrap gap-2">
                {tool.bot_info.suggested_questions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendChat(q)}
                    className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 快捷输入参数表单 - 固定底部 */}
          {tool.parameters_schema && tool.parameters_schema.length > 0 && (
            <div className="border-t bg-white px-4 py-3 shrink-0">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">快捷输入</span>
                </div>
                <button
                  onClick={() => {
                    setParamValues({});
                    setShowParamForm(true);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  title="重置"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {tool.parameters_schema.map((param) => (
                  <div key={param.name} className={tool.parameters_schema!.length % 2 === 1 && param === tool.parameters_schema![tool.parameters_schema!.length - 1] ? 'col-span-2' : ''}>
                    <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                      {param.label}
                      {param.required && <span className="text-red-500">*</span>}
                    </label>
                    {(param.type === 'image' || param.type === 'audio' || param.type === 'video') ? (
                      <MediaParamInput
                        value={paramValues[param.name] || param.defaultValue || ''}
                        placeholder={param.placeholder || `${param.type === 'image' ? '图片' : param.type === 'audio' ? '音频' : '视频'}URL或上传`}
                        onChange={(val) => setParamValues(prev => ({ ...prev, [param.name]: val }))}
                        mediaType={param.type as 'image' | 'audio' | 'video'}
                      />
                    ) : param.type === 'textarea' ? (
                      <textarea
                        value={paramValues[param.name] || param.defaultValue || ''}
                        onChange={(e) => setParamValues(prev => ({ ...prev, [param.name]: e.target.value }))}
                        placeholder={param.placeholder || `请输入${param.label}`}
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                        rows={2}
                      />
                    ) : (
                      <input
                        type="text"
                        value={paramValues[param.name] || param.defaultValue || ''}
                        onChange={(e) => setParamValues(prev => ({ ...prev, [param.name]: e.target.value }))}
                        placeholder={param.placeholder || `请输入${param.label}`}
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const schema = tool.parameters_schema!;
                  // 校验必填项
                  const missingRequired = schema.filter(
                    p => p.required && !paramValues[p.name]?.trim() && !p.defaultValue
                  );
                  if (missingRequired.length > 0) {
                    alert(`请填写以下必填项：${missingRequired.map(p => p.label).join('、')}`);
                    return;
                  }

                  if (isBot) {
                    // Bot：把参数拼接成自然语言 input
                    const parts = schema
                      .filter(p => paramValues[p.name]?.trim() || p.defaultValue)
                      .map(p => `${p.label}：${paramValues[p.name]?.trim() || p.defaultValue}`);
                    if (parts.length > 0) handleSendChat(parts.join('\n'));
                  } else {
                    // Workflow：直接传结构化参数对象
                    const params: Record<string, string> = {};
                    for (const p of schema) {
                      const v = paramValues[p.name]?.trim() || p.defaultValue;
                      if (v) params[p.name] = v;
                    }
                    if (Object.keys(params).length > 0) handleRunWorkflow(params);
                  }
                }}
                disabled={isSending}
                className="w-full mt-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
              >
                <Send className="h-3.5 w-3.5" />
                点击发送
              </button>
            </div>
          )}

          {/* Chat Input */}
          <div className="border-t bg-white px-4 py-3 shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSendChat(); }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={tool.bot_available === false ? '智能体暂不可用' : !cozeConnected ? '请先连接 Coze 账户' : '输入消息...'}
                disabled={isSending || tool.bot_available === false || !cozeConnected}
                className="flex-1"
              />
              <Button type="submit" disabled={isSending || !inputValue.trim() || tool.bot_available === false || !cozeConnected} size="icon">
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <div className="text-xs text-gray-400 mt-1 text-center">
              使用您的 Coze 额度 · 对话内容由 AI 生成，仅供参考
            </div>
          </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : isActivated && !isBot ? (
        /* ========== Workflow Mode ========== */
        <div className="flex-1 p-4 max-w-2xl mx-auto w-full">
          {tool.description && (
            <p className="text-gray-600 text-sm mb-4">{tool.description}</p>
          )}

          <div className="bg-white rounded-lg border p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">输入</label>
              <Input
                value={workflowInput}
                onChange={(e) => setWorkflowInput(e.target.value)}
                placeholder={!cozeConnected ? '请先连接 Coze 账户' : '请输入工作流参数...'}
                disabled={isRunningWorkflow || !cozeConnected}
              />
            </div>

            <Button
              onClick={() => handleRunWorkflow()}
              disabled={isRunningWorkflow || !workflowInput.trim() || !cozeConnected}
              className="w-full"
            >
              {isRunningWorkflow ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 执行中...</>
              ) : (
                <><Zap className="h-4 w-4 mr-2" /> 执行工作流</>
              )}
            </Button>

            {workflowResult && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出</label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                  {workflowResult}
                </div>
              </div>
            )}
          </div>

          {!cozeConnected && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">Coze 账户未连接，请先完成 Coze 授权后再使用工作流。</span>
              <Button size="sm" variant="outline" onClick={handleConnectCoze} className="text-xs h-7 border-red-300 text-red-700 hover:bg-red-100 whitespace-nowrap">
                <Link2 className="h-3 w-3 mr-1" /> 连接 Coze
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* 使用教程弹窗 */}
      {showTutorial && tool.tutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowTutorial(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-gray-900">使用教程</h3>
              <button onClick={() => setShowTutorial(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{
                  __html: tool.tutorial
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/&lt;a\s+href=&quot;([^&]+)&quot;\s*&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">')
                    .replace(/&lt;\/a&gt;/g, '</a>')
                    .replace(/&lt;br\s*\/?&gt;/g, '<br/>')
                    .replace(/\n/g, '<br/>')
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
