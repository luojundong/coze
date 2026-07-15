'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Pencil, X, Loader2, Tag, GripVertical } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSort, setFormSort] = useState('0');

  // Edit state
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editSort, setEditSort] = useState('0');

  const fetchCategories = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/categories', {
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      setCategories(data.categories || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleAdd = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    const token = getToken();
    if (!token) { alert('请先登录'); setSaving(false); return; }
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ name: formName.trim(), sort_order: parseInt(formSort) || 0 }),
      });
      if (res.ok) {
        setShowAdd(false);
        setFormName('');
        setFormSort('0');
        fetchCategories();
      } else {
        const data = await res.json();
        alert(data.error || '添加失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editCat) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({ id: editCat.id, name: editName.trim(), sort_order: parseInt(editSort) || 0 }),
    });
    if (res.ok) {
      setEditCat(null);
      fetchCategories();
    } else {
      const data = await res.json();
      alert(data.error || '修改失败');
    }
  };

  const handleDelete = async (cat: Category) => {
    if (!confirm(`确定删除分类「${cat.name}」？`)) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch(`/api/admin/categories?id=${cat.id}`, {
      method: 'DELETE',
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.affectedTools > 0) {
        alert(`分类已删除。注意：${data.affectedTools} 个工具仍引用「${data.categoryName}」，建议手动更新。`);
      }
      fetchCategories();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '删除失败');
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
          <h1 className="text-xl font-semibold text-gray-900">分类管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理工具的显示分类，用户端将按分类筛选工具</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-1" /> 添加分类
        </Button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">添加分类</CardTitle>
              <button onClick={() => { setShowAdd(false); setFormName(''); setFormSort('0'); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">分类名称 *</label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="如：写作、翻译、编程" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">排序权重</label>
                <Input type="number" min="0" value={formSort} onChange={(e) => setFormSort(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleAdd} disabled={saving || !formName.trim()} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                确认添加
              </Button>
              <Button variant="outline" onClick={() => { setShowAdd(false); setFormName(''); setFormSort('0'); }}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Categories List */}
      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            暂无分类，点击上方「添加分类」开始创建
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {categories.map((cat) => (
            <Card key={cat.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <Tag className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="font-medium text-gray-900">{cat.name}</span>
                    <Badge variant="outline" className="text-xs shrink-0">排序: {cat.sort_order}</Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditCat(cat); setEditName(cat.name); setEditSort(String(cat.sort_order)); }}
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(cat)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {editCat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">编辑分类</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">分类名称</label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">排序权重</label>
                <Input type="number" min="0" value={editSort} onChange={e => setEditSort(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setEditCat(null)}>取消</Button>
              <Button onClick={handleEdit} disabled={!editName.trim()}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
