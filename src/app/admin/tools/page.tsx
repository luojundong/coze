'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Trash2, ToggleLeft, ToggleRight, Workflow, Bot, Loader2, X, Pencil, ChevronLeft, ChevronRight,
} from 'lucide-react';

// 参数预设项的类型定义
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
  description: string | null;
  type: string;
  category: string;
  icon_url: string | null;
  is_enabled: boolean;
  credit_cost: number;
  parameters_schema: Record<string, unknown> | null;
  tutorial: string | null;
  opening_statement: string | null;
  suggested_questions: string[] | null;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

export default function AdminToolsPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<{ category: string; cnt: number }[]>([]);
  const pageSize = 10;

  // Form state
  const [formCozeId, setFormCozeId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('workflow');
  const [formCategory, setFormCategory] = useState('');
  const [formIconUrl, setFormIconUrl] = useState('');
  const [formCreditCost, setFormCreditCost] = useState('1');
  const [formSortOrder, setFormSortOrder] = useState('0');
  const [formParamsSchema, setFormParamsSchema] = useState<ParamPreset[]>([]);
  const [formTutorial, setFormTutorial] = useState('');
  const [formOpeningStatement, setFormOpeningStatement] = useState('');
  const [formSuggestedQuestions, setFormSuggestedQuestions] = useState('');
  const [categoryList, setCategoryList] = useState<{ id: string; name: string }[]>([]);

  const fetchTools = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (selectedCategory) params.set('category', selectedCategory);
    const res = await fetch(`/api/admin/workflow-configs?${params}`, {
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      setTools(data.configs || []);
      setTotal(data.total || 0);
      // 更新分类列表（仅在"全部"模式下更新，避免频繁刷新Tabs数量）
      if (!selectedCategory && data.categories) {
        setCategories(data.categories || []);
      }
    }
    setLoading(false);
  }, [page, selectedCategory]);

  const fetchCategories = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/categories', {
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      setCategoryList(data.categories || []);
    }
  }, []);

  useEffect(() => { fetchTools(); fetchCategories(); }, [fetchTools, fetchCategories]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleAdd = async () => {
    if (!formCozeId.trim() || !formName.trim()) return;
    setSaving(true);
    const token = getToken();
    if (!token) { alert('请先登录'); setSaving(false); return; }
    try {
      const res = await fetch('/api/admin/workflow-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          coze_id: formCozeId.trim(),
          name: formName.trim(),
          description: formDesc.trim() || null,
          type: formType,
          category: formCategory.trim() || '',
          icon_url: formIconUrl.trim() || null,
          credit_cost: isNaN(parseInt(formCreditCost)) ? 1 : parseInt(formCreditCost),
          sort_order: parseInt(formSortOrder) || 0,
          parameters_schema: formParamsSchema.length > 0 ? formParamsSchema : null,
          tutorial: formTutorial.trim() || null,
          opening_statement: formOpeningStatement.trim() || null,
          suggested_questions: formSuggestedQuestions.trim()
            ? formSuggestedQuestions.split('\n').filter(q => q.trim())
            : null,
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        resetForm();
        fetchTools();
      } else {
        const data = await res.json();
        alert(data.error || '添加失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (tool: ToolConfig) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/workflow-configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({ id: tool.id, is_enabled: !tool.is_enabled }),
    });
    if (res.ok) { fetchTools(); } else { const d = await res.json().catch(() => ({})); alert(d.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此工具配置？删除后用户端将不再展示此工具。')) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch(`/api/admin/workflow-configs?id=${id}`, {
      method: 'DELETE',
      headers: { 'x-session': token },
    });
    if (res.ok) { fetchTools(); } else { const d = await res.json().catch(() => ({})); alert(d.error || '删除失败'); }
  };

  // 编辑状态
  const [editTool, setEditTool] = useState<ToolConfig | null>(null);
  const [editCozeId, setEditCozeId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCreditCost, setEditCreditCost] = useState('1');
  const [editType, setEditType] = useState('workflow');
  const [editParamsSchema, setEditParamsSchema] = useState<ParamPreset[]>([]);
  const [editTutorial, setEditTutorial] = useState('');
  const [editOpeningStatement, setEditOpeningStatement] = useState('');
  const [editSuggestedQuestions, setEditSuggestedQuestions] = useState('');

  const openEdit = (tool: ToolConfig) => {
    setEditTool(tool);
    setEditCozeId(tool.coze_id);
    setEditName(tool.name);
    setEditDesc(tool.description || '');
    setEditCategory(tool.category || '');
    setEditCreditCost(String(tool.credit_cost));
    setEditType(tool.type);
    setEditTutorial(tool.tutorial || '');
    setEditOpeningStatement(tool.opening_statement || '');
    setEditSuggestedQuestions(Array.isArray(tool.suggested_questions) ? tool.suggested_questions.join('\n') : '');
    // 解析 parameters_schema
    const schema = tool.parameters_schema as ParamPreset[] | null;
    setEditParamsSchema(Array.isArray(schema) ? schema : []);
  };

  const handleEdit = async () => {
    if (!editTool) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/workflow-configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({
        id: editTool.id,
        coze_id: editCozeId,
        name: editName,
        description: editDesc,
        category: editCategory,
        credit_cost: isNaN(parseInt(editCreditCost)) ? 1 : parseInt(editCreditCost),
        type: editType,
        parameters_schema: editParamsSchema.length > 0 ? editParamsSchema : null,
        tutorial: editTutorial.trim() || null,
        opening_statement: editOpeningStatement.trim() || null,
        suggested_questions: editSuggestedQuestions.trim()
          ? editSuggestedQuestions.split('\n').filter(q => q.trim())
          : null,
      }),
    });
    if (res.ok) { setEditTool(null); fetchTools(); } else { const d = await res.json().catch(() => ({})); alert(d.error || '修改失败'); }
  };

  const resetForm = () => {
    setFormCozeId('');
    setFormName('');
    setFormDesc('');
    setFormType('workflow');
    setFormCategory('');
    setFormIconUrl('');
    setFormCreditCost('1');
    setFormSortOrder('0');
    setFormParamsSchema([]);
    setFormTutorial('');
    setFormOpeningStatement('');
    setFormSuggestedQuestions('');
  };

  // 参数预设管理
  const addParamPreset = (target: 'add' | 'edit') => {
    const newParam: ParamPreset = { name: '', label: '', placeholder: '', type: 'text', defaultValue: '', required: false };
    if (target === 'add') {
      setFormParamsSchema(prev => [...prev, newParam]);
    } else {
      setEditParamsSchema(prev => [...prev, newParam]);
    }
  };

  const updateParamPreset = (target: 'add' | 'edit', index: number, field: keyof ParamPreset, value: any) => {
    if (target === 'add') {
      setFormParamsSchema(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    } else {
      setEditParamsSchema(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    }
  };

  const removeParamPreset = (target: 'add' | 'edit', index: number) => {
    if (target === 'add') {
      setFormParamsSchema(prev => prev.filter((_, i) => i !== index));
    } else {
      setEditParamsSchema(prev => prev.filter((_, i) => i !== index));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">工具管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理智能体和工作流，控制用户可用的 AI 工具</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-1" /> 添加工具
        </Button>
      </div>

      {/* Add Form Dialog */}
      {showAdd && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">添加工具</CardTitle>
              <button onClick={() => { setShowAdd(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Coze ID *</Label>
                <Input value={formCozeId} onChange={(e) => setFormCozeId(e.target.value)} placeholder="workflow_id 或 bot_id" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">工具名称 *</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="展示给用户的名称" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">描述</Label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="工具功能描述" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">类型</Label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                >
                  <option value="workflow">工作流</option>
                  <option value="bot">智能体（对话模式）</option>
                </select>
                {formType === 'bot' && (
                  <p className="text-xs text-amber-600 mt-1">智能体将使用多轮对话模式，保留上下文和预设提示词</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">分类</Label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                >
                  <option value="">未分类</option>
                  {categoryList.map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-0.5">
                  在 <a href="/admin/categories" className="text-blue-500 hover:underline">分类管理</a> 中添加更多分类
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">每次积分消耗</Label>
                <Input type="number" min="0" value={formCreditCost} onChange={(e) => setFormCreditCost(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">排序权重</Label>
                <Input type="number" min="0" value={formSortOrder} onChange={(e) => setFormSortOrder(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">图标 URL（可选）</Label>
              <Input value={formIconUrl} onChange={(e) => setFormIconUrl(e.target.value)} placeholder="https://..." />
            </div>

            {/* 参数预设配置 */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">快捷输入参数预设（可选）</Label>
                <Button variant="outline" size="sm" onClick={() => addParamPreset('add')} className="text-xs h-7">
                  <Plus className="w-3 h-3 mr-1" /> 添加参数
                </Button>
              </div>
              <p className="text-xs text-gray-400">为用户提供结构化的参数输入表单，适用于智能体类型工具</p>
              {formParamsSchema.length > 0 && (
                <div className="space-y-3 mt-2">
                  {formParamsSchema.map((param, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">参数 {idx + 1}</span>
                        <button onClick={() => removeParamPreset('add', idx)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">参数名 *</Label>
                          <Input
                            value={param.name}
                            onChange={(e) => updateParamPreset('add', idx, 'name', e.target.value)}
                            placeholder="e.g. wenan"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">显示标签 *</Label>
                          <Input
                            value={param.label}
                            onChange={(e) => updateParamPreset('add', idx, 'label', e.target.value)}
                            placeholder="e.g. 文案内容"
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">类型</Label>
                          <select
                            value={param.type || 'text'}
                            onChange={(e) => updateParamPreset('add', idx, 'type', e.target.value)}
                            className="w-full h-8 rounded-md border border-gray-300 px-2 text-xs"
                          >
                            <option value="text">单行文本</option>
                            <option value="textarea">多行文本</option>
                            <option value="image">图片(URL/上传)</option>
                            <option value="audio">音频(URL/上传)</option>
                            <option value="video">视频(URL/上传)</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs">默认值(URL)</Label>
                          <Input
                            value={param.defaultValue || ''}
                            onChange={(e) => updateParamPreset('add', idx, 'defaultValue', e.target.value)}
                            placeholder="可选，图片URL"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">占位提示</Label>
                          <Input
                            value={param.placeholder || ''}
                            onChange={(e) => updateParamPreset('add', idx, 'placeholder', e.target.value)}
                            placeholder="可选"
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={param.required || false}
                          onChange={(e) => updateParamPreset('add', idx, 'required', e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-gray-300"
                        />
                        <Label className="text-xs text-gray-600">必填项（用户使用前必须填写）</Label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bot 预设内容（仅 Bot 类型显示） */}
            {formType === 'bot' && (
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">开场白（可选）</Label>
                  <p className="text-xs text-gray-400">Bot 对话开始时显示的欢迎语。数据库优先于 Coze API，留空则从 Coze 动态获取。</p>
                  <textarea
                    value={formOpeningStatement}
                    onChange={(e) => setFormOpeningStatement(e.target.value)}
                    placeholder="输入 Bot 开场白..."
                    className="w-full border rounded-md p-3 text-sm min-h-[80px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">推荐问题（可选）</Label>
                  <p className="text-xs text-gray-400">每行一个问题，用户可点击快速发送。数据库优先于 Coze API，留空则从 Coze 动态获取。</p>
                  <textarea
                    value={formSuggestedQuestions}
                    onChange={(e) => setFormSuggestedQuestions(e.target.value)}
                    placeholder={"推荐问题 1\n推荐问题 2\n推荐问题 3"}
                    className="w-full border rounded-md p-3 text-sm min-h-[80px]"
                  />
                </div>
              </div>
            )}

            {/* 使用教程 */}
            <div className="space-y-1.5 border-t pt-4">
              <Label className="text-sm font-medium">使用教程（可选）</Label>
              <p className="text-xs text-gray-400">支持纯文本和链接，用户点击"使用教程"按钮可查看。示例：&lt;a href="https://example.com"&gt;查看文档&lt;/a&gt;</p>
              <textarea
                value={formTutorial}
                onChange={(e) => setFormTutorial(e.target.value)}
                placeholder="输入使用教程内容，支持HTML链接..."
                className="w-full border rounded-md p-3 text-sm min-h-[100px]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleAdd} disabled={saving || !formCozeId.trim() || !formName.trim()} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                确认添加
              </Button>
              <Button variant="outline" onClick={() => { setShowAdd(false); resetForm(); }}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Tabs */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pb-1">
          <button
            onClick={() => { setSelectedCategory(''); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !selectedCategory
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            全部 ({total})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => { setSelectedCategory(cat.category); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat.category
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat.category} ({cat.cnt})
            </button>
          ))}
        </div>
      )}

      {/* Tool Cards */}
      {tools.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            暂无工具配置，点击上方「添加工具」开始配置
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <Card key={tool.id} className={`transition-opacity ${!tool.is_enabled ? 'opacity-60' : ''}`}>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    tool.type === 'bot' ? 'bg-purple-100' : 'bg-blue-100'
                  }`}>
                    {tool.type === 'bot'
                      ? <Bot className="w-4.5 h-4.5 text-purple-600" />
                      : <Workflow className="w-4.5 h-4.5 text-blue-600" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{tool.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {tool.type === 'bot' ? '智能体·对话' : '工作流'}
                      </Badge>
                      <Badge variant={tool.is_enabled ? 'default' : 'secondary'} className="text-xs">
                        {tool.is_enabled ? '已启用' : '已禁用'}
                      </Badge>
                      {!selectedCategory && tool.category && (
                        <Badge variant="outline" className="text-xs text-gray-400">{tool.category}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span>ID: {tool.coze_id}</span>
                      {tool.description && <span className="ml-2">· {tool.description}</span>}
                    </div>
                  </div>

                  {/* Credit Cost */}
                  <div className="text-center px-3">
                    <div className="text-base font-semibold text-gray-900">{tool.credit_cost}</div>
                    <div className="text-xs text-gray-500">积分/次</div>
                  </div>

                  {/* Sort Order */}
                  <div className="text-center px-2">
                    <div className="text-sm text-gray-700">{tool.sort_order}</div>
                    <div className="text-xs text-gray-500">排序</div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(tool)} title="编辑">
                      <Pencil className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(tool)} title={tool.is_enabled ? '点击禁用' : '点击启用'}>
                      {tool.is_enabled
                        ? <ToggleRight className="w-5 h-5 text-green-600" />
                        : <ToggleLeft className="w-5 h-5 text-gray-400" />
                      }
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(tool.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">共 {total} 个工具，第 {page}/{totalPages} 页</span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                >
                  下一页<ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editTool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">编辑工具</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Coze ID</label>
                <Input value={editCozeId} onChange={e => setEditCozeId(e.target.value)} placeholder="workflow_id 或 bot_id" />
                <p className="text-xs text-amber-600 mt-1">更换 Coze 账户后，需更新此 ID 为新账户下的 Bot/Workflow ID</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">名称</label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea className="w-full border rounded-md p-2 text-sm" rows={3} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">类型</label>
                <select className="w-full border rounded-md p-2 text-sm" value={editType} onChange={e => setEditType(e.target.value)}>
                  <option value="bot">智能体（对话模式）</option>
                  <option value="workflow">工作流（参数模式）</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">分类</label>
                <select
                  className="w-full border rounded-md p-2 text-sm"
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                >
                  <option value="">未分类</option>
                  {categoryList.map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">每次消耗积分</label>
                <Input type="number" min={0} value={editCreditCost} onChange={e => setEditCreditCost(e.target.value)} />
              </div>

              {/* 编辑 - 参数预设配置 */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">快捷输入参数预设</label>
                  <Button variant="outline" size="sm" onClick={() => addParamPreset('edit')} className="text-xs h-7">
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                </div>
                {editParamsSchema.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {editParamsSchema.map((param, idx) => (
                      <div key={idx} className="border rounded-md p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">参数 {idx + 1}</span>
                          <button onClick={() => removeParamPreset('edit', idx)} className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <Input
                            value={param.name}
                            onChange={(e) => updateParamPreset('edit', idx, 'name', e.target.value)}
                            placeholder="参数名"
                            className="h-7 text-xs"
                          />
                          <Input
                            value={param.label}
                            onChange={(e) => updateParamPreset('edit', idx, 'label', e.target.value)}
                            placeholder="显示标签"
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <select
                            value={param.type || 'text'}
                            onChange={(e) => updateParamPreset('edit', idx, 'type', e.target.value)}
                            className="h-7 rounded border border-gray-300 px-1.5 text-xs"
                          >
                            <option value="text">单行</option>
                            <option value="textarea">多行</option>
                            <option value="image">图片</option>
                            <option value="audio">音频</option>
                            <option value="video">视频</option>
                          </select>
                          <Input
                            value={param.defaultValue || ''}
                            onChange={(e) => updateParamPreset('edit', idx, 'defaultValue', e.target.value)}
                            placeholder="默认URL"
                            className="h-7 text-xs"
                          />
                          <Input
                            value={param.placeholder || ''}
                            onChange={(e) => updateParamPreset('edit', idx, 'placeholder', e.target.value)}
                            placeholder="占位提示"
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={param.required || false}
                            onChange={(e) => updateParamPreset('edit', idx, 'required', e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300"
                          />
                          <Label className="text-xs text-gray-600">必填项</Label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 编辑 - Bot 预设内容（仅 Bot 类型显示） */}
              {editType === 'bot' && (
                <div className="border-t pt-4 space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">开场白（可选）</label>
                    <p className="text-xs text-gray-400 mb-2">Bot 对话开始时显示的欢迎语。留空则从 Coze API 动态获取。</p>
                    <textarea
                      className="w-full border rounded-md p-3 text-sm min-h-[80px]"
                      value={editOpeningStatement}
                      onChange={(e) => setEditOpeningStatement(e.target.value)}
                      placeholder="输入 Bot 开场白..."
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">推荐问题（可选）</label>
                    <p className="text-xs text-gray-400 mb-2">每行一个问题。留空则从 Coze API 动态获取。</p>
                    <textarea
                      className="w-full border rounded-md p-3 text-sm min-h-[80px]"
                      value={editSuggestedQuestions}
                      onChange={(e) => setEditSuggestedQuestions(e.target.value)}
                      placeholder={"推荐问题 1\n推荐问题 2\n推荐问题 3"}
                    />
                  </div>
                </div>
              )}

              {/* 编辑 - 使用教程 */}
              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1 block">使用教程（可选）</label>
                <p className="text-xs text-gray-400 mb-2">支持纯文本和链接，示例：&lt;a href="https://example.com"&gt;查看文档&lt;/a&gt;</p>
                <textarea
                  className="w-full border rounded-md p-3 text-sm min-h-[100px]"
                  value={editTutorial}
                  onChange={(e) => setEditTutorial(e.target.value)}
                  placeholder="输入使用教程内容..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setEditTool(null)}>取消</Button>
              <Button onClick={handleEdit}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
