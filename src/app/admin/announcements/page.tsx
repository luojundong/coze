'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getToken } from '@/lib/api-client';
import { uploadFile } from '@/lib/upload-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Plus, Trash2, Pencil, X, Pin, PinOff, Megaphone, Loader2, Image as ImageIcon, Video, Link2,
} from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  content: string;
  is_pinned: number;
  is_published: number;
  created_at: string;
  updated_at: string | null;
}

/** 剥离 HTML 标签，只保留纯文本 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 内容编辑工具条：插入图片 / 视频 / 链接 */
function ContentToolbar({ onInsert }: { onInsert: (snippet: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<'image' | 'video' | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (kind: 'image' | 'video') => {
    setPending(kind);
    fileRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const kind = pending;
    e.target.value = '';
    if (!file || !kind) return;
    setBusy(true);
    try {
      const url = await uploadFile(file, 'content', kind === 'video' ? 'media' : 'image');
      onInsert(kind === 'image' ? `<img src="${url}" />\n` : `<video src="${url}" controls></video>\n`);
    } catch (err: any) {
      alert(err?.message || '上传失败');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const handleLink = () => {
    const url = window.prompt('请输入链接地址（https://...）');
    if (!url) return;
    const text = window.prompt('请输入链接显示文字', url) || url;
    onInsert(`<a href="${url}">${text}</a>\n`);
  };

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => pick('image')}>
        {busy && pending === 'image' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImageIcon className="w-4 h-4 mr-1" />}
        插入图片
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => pick('video')}>
        {busy && pending === 'video' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Video className="w-4 h-4 mr-1" />}
        插入视频
      </Button>
      <Button variant="outline" size="sm" onClick={handleLink}>
        <Link2 className="w-4 h-4 mr-1" /> 插入链接
      </Button>
    </div>
  );
}

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [formPublished, setFormPublished] = useState(true);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editPinned, setEditPinned] = useState(false);
  const [editPublished, setEditPublished] = useState(true);

  const fetchAnnouncements = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/announcements', {
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      setAnnouncements(data.announcements || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const handleAdd = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    setSaving(true);
    const token = getToken();
    if (!token) { setSaving(false); return; }
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          title: formTitle.trim(),
          content: formContent.trim(),
          is_pinned: formPinned,
          is_published: formPublished,
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        setFormTitle('');
        setFormContent('');
        setFormPinned(false);
        setFormPublished(true);
        fetchAnnouncements();
      } else {
        const d = await res.json();
        alert(d.error || '创建失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (a: Announcement) => {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditContent(a.content);
    setEditPinned(!!a.is_pinned);
    setEditPublished(!!a.is_published);
  };

  const handleEdit = async () => {
    if (!editingId) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/announcements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({
        id: editingId,
        title: editTitle,
        content: editContent,
        is_pinned: editPinned,
        is_published: editPublished,
      }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchAnnouncements();
    } else {
      const d = await res.json();
      alert(d.error || '修改失败');
    }
  };

  const handleTogglePublish = async (a: Announcement) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/announcements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({
        id: a.id,
        is_published: !a.is_published,
      }),
    });
    if (res.ok) fetchAnnouncements();
  };

  const handleTogglePin = async (a: Announcement) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/admin/announcements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({
        id: a.id,
        is_pinned: !a.is_pinned,
      }),
    });
    if (res.ok) fetchAnnouncements();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此公告？')) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch(`/api/admin/announcements?id=${id}`, {
      method: 'DELETE',
      headers: { 'x-session': token },
    });
    if (res.ok) fetchAnnouncements();
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
          <h1 className="text-xl font-semibold text-gray-900">公告管理</h1>
          <p className="text-sm text-gray-500 mt-1">发布和管理平台公告，同步展示在网页端和小程序首页（支持图片、视频、链接）</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-1" /> 发布公告
        </Button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">发布新公告</CardTitle>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">标题 *</Label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="公告标题" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">内容 *（支持图片、视频、链接）</Label>
              <ContentToolbar onInsert={(s) => setFormContent((f) => f + s)} />
              <Textarea value={formContent} onChange={e => setFormContent(e.target.value)} placeholder={'支持纯文本和 HTML：<img src="图片地址">、<video src="视频地址" controls></video>、<a href="链接">文字</a>'} rows={4} />
            </div>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <Switch checked={formPinned} onCheckedChange={setFormPinned} id="pin-add" />
                <Label htmlFor="pin-add" className="text-sm cursor-pointer">置顶</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={formPublished} onCheckedChange={setFormPublished} id="pub-add" />
                <Label htmlFor="pub-add" className="text-sm cursor-pointer">立即发布</Label>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleAdd} disabled={saving || !formTitle.trim() || !formContent.trim()} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                确认发布
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Announcement List */}
      {announcements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <Megaphone className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            暂无公告，点击上方「发布公告」开始
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id} className={`${!a.is_published ? 'opacity-60' : ''}`}>
              <CardContent className="py-4">
                {editingId === a.id ? (
                  /* Edit Mode */
                  <div className="space-y-3">
                    <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                    <div>
                      <ContentToolbar onInsert={(s) => setEditContent((f) => f + s)} />
                      <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={3} placeholder="支持纯文本和HTML链接" />
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Switch checked={editPinned} onCheckedChange={setEditPinned} id="pin-edit" />
                        <Label htmlFor="pin-edit" className="text-sm cursor-pointer">置顶</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={editPublished} onCheckedChange={setEditPublished} id="pub-edit" />
                        <Label htmlFor="pub-edit" className="text-sm cursor-pointer">已发布</Label>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleEdit}>保存</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Megaphone className="w-4 h-4 text-blue-500 shrink-0" />
                        <span className="font-medium text-gray-900 truncate">{a.title}</span>
                        {!!a.is_pinned && (
                          <Badge variant="default" className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-100">
                            <Pin className="w-3 h-3 mr-0.5" />置顶
                          </Badge>
                        )}
                        {!a.is_published && (
                          <Badge variant="outline" className="text-xs">草稿</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-2">{stripHtml(a.content)}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(a.created_at).toLocaleString('zh-CN')}
                        {a.updated_at && ` · 更新于 ${new Date(a.updated_at).toLocaleString('zh-CN')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => handleTogglePin(a)} title={a.is_pinned ? '取消置顶' : '置顶'}>
                        {a.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleTogglePublish(a)} title={a.is_published ? '下架' : '发布'}>
                        <Badge variant={a.is_published ? 'default' : 'outline'} className="text-xs">
                          {a.is_published ? '已发布' : '草稿'}
                        </Badge>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(a)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(a.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
