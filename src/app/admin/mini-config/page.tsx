'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { uploadFile } from '@/lib/upload-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Image as ImageIcon, Video, Link2, Save, Upload } from 'lucide-react';

type ButtonKey = 'contact_teacher' | 'tutorial' | 'share';

interface ConfigState {
  buttons: {
    contact_teacher: { text: string; icon: string };
    tutorial: { text: string; icon: string };
    share: { text: string; icon: string };
  };
  contact_teacher_content: string;
}

const BUTTON_LABELS: Record<ButtonKey, string> = {
  contact_teacher: '联系老师',
  tutorial: '使用教程',
  share: '分享',
};

const DEFAULT_CONFIG: ConfigState = {
  buttons: {
    contact_teacher: { text: '联系老师', icon: '' },
    tutorial: { text: '使用教程', icon: '' },
    share: { text: '分享', icon: '' },
  },
  contact_teacher_content: '',
};

export default function AdminMiniConfigPage() {
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    kind: 'icon' | 'content-image' | 'content-video';
    key?: ButtonKey | 'contact_teacher' | 'tutorial';
  } | null>(null);

  const fetchConfig = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/admin/mini-config', { headers: { 'x-session': token } });
      if (res.ok) {
        const data = await res.json();
        setConfig({
          buttons: data.buttons || DEFAULT_CONFIG.buttons,
          contact_teacher_content: data.contact_teacher_content || '',
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const updateButtonText = (key: ButtonKey, value: string) => {
    setConfig((c) => ({
      ...c,
      buttons: { ...c.buttons, [key]: { ...c.buttons[key], text: value } },
    }));
  };

  const updateButtonIcon = (key: ButtonKey, value: string) => {
    setConfig((c) => ({
      ...c,
      buttons: { ...c.buttons, [key]: { ...c.buttons[key], icon: value } },
    }));
  };

  const appendContent = (key: 'contact_teacher', snippet: string) => {
    const field = `${key}_content` as const;
    setConfig((c) => ({ ...c, [field]: (c[field] || '') + snippet }));
  };

  const triggerUpload = (
    target: typeof uploadTarget
  ) => {
    if (!target) return;
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = uploadTarget;
    e.target.value = '';
    if (!file || !target) return;

    setUploading(`${target.kind}-${target.key || ''}`);
    try {
      if (target.kind === 'icon' && target.key) {
        const url = await uploadFile(file, 'icon', 'image');
        updateButtonIcon(target.key as ButtonKey, url);
      } else if (target.kind === 'content-image' && target.key) {
        const url = await uploadFile(file, 'content', 'image');
        appendContent(target.key as 'contact_teacher', `<img src="${url}" />\n`);
      } else if (target.kind === 'content-video' && target.key) {
        const url = await uploadFile(file, 'content', 'media');
        appendContent(target.key as 'contact_teacher', `<video src="${url}" controls></video>\n`);
      }
    } catch (err: any) {
      alert(err?.message || '上传失败');
    } finally {
      setUploading(null);
      setUploadTarget(null);
    }
  };

  const insertLink = (key: 'contact_teacher') => {
    const url = window.prompt('请输入链接地址（https://...）');
    if (!url) return;
    const text = window.prompt('请输入链接显示文字', url) || url;
    appendContent(key, `<a href="${url}">${text}</a>\n`);
  };

  const handleSave = async () => {
    setSaving(true);
    const token = getToken();
    if (!token) { setSaving(false); return; }
    const { buttons, contact_teacher_content } = config;
    const body = {
      contact_teacher_text: buttons.contact_teacher.text,
      contact_teacher_icon: buttons.contact_teacher.icon,
      tutorial_text: buttons.tutorial.text,
      tutorial_icon: buttons.tutorial.icon,
      share_text: buttons.share.text,
      share_icon: buttons.share.icon,
      contact_teacher_content,
    };
    try {
      const res = await fetch('/api/admin/mini-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        alert('保存成功');
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || '保存失败');
      }
    } catch {
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const buttonKeys: ButtonKey[] = ['contact_teacher', 'tutorial', 'share'];

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFile}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">首页配置</h1>
          <p className="text-sm text-gray-500 mt-1">
            配置小程序首页三个快捷按钮的文字与图标；「联系老师」按钮点开后的展示内容（支持图片、视频、链接）。「使用教程」按钮打开各工具自带的使用教程，无需在此编辑。
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          保存配置
        </Button>
      </div>

      {/* 按钮配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">快捷按钮配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {buttonKeys.map((key) => (
            <div key={key} className="flex flex-col gap-3 border rounded-lg p-3 sm:flex-row sm:items-center">
              <div className="w-28 shrink-0 text-sm font-medium text-gray-700">{BUTTON_LABELS[key]}</div>
              <div className="flex-1">
                <Label className="text-xs text-gray-500">按钮文字</Label>
                <Input
                  value={config.buttons[key].text}
                  onChange={(e) => updateButtonText(key, e.target.value)}
                  placeholder="按钮显示文字"
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50">
                  {config.buttons[key].icon ? (
                    <img src={config.buttons[key].icon} alt="icon" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-xs text-gray-400">无图标</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading === `icon-${key}`}
                  onClick={() => triggerUpload({ kind: 'icon', key })}
                >
                  {uploading === `icon-${key}` ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-1" />
                  )}
                  上传图标
                </Button>
                {config.buttons[key].icon && (
                  <Button variant="ghost" size="sm" onClick={() => updateButtonIcon(key, '')}>
                    清除
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 联系老师内容 */}
      <ContentEditor
        title="联系老师 - 内容"
        hint="展示在「联系老师」按钮点开后的页面，支持图片、视频、链接。"
        value={config.contact_teacher_content}
        onChange={(v) => setConfig((c) => ({ ...c, contact_teacher_content: v }))}
        onUploadImage={() => triggerUpload({ kind: 'content-image', key: 'contact_teacher' })}
        onUploadVideo={() => triggerUpload({ kind: 'content-video', key: 'contact_teacher' })}
        onInsertLink={() => insertLink('contact_teacher')}
        uploading={uploading === 'content-image-contact_teacher' || uploading === 'content-video-contact_teacher'}
      />
    </div>
  );
}

function ContentEditor({
  title,
  hint,
  value,
  onChange,
  onUploadImage,
  onUploadVideo,
  onInsertLink,
  uploading,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onUploadImage: () => void;
  onUploadVideo: () => void;
  onInsertLink: () => void;
  uploading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={uploading} onClick={onUploadImage}>
            <ImageIcon className="w-4 h-4 mr-1" /> 插入图片
          </Button>
          <Button variant="outline" size="sm" disabled={uploading} onClick={onUploadVideo}>
            <Video className="w-4 h-4 mr-1" /> 插入视频
          </Button>
          <Button variant="outline" size="sm" onClick={onInsertLink}>
            <Link2 className="w-4 h-4 mr-1" /> 插入链接
          </Button>
        </div>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder={'内容支持 HTML：<img src="图片地址">、<video src="视频地址" controls></video>、<a href="链接">文字</a>，也支持纯文本与换行。'}
          className="font-mono text-xs"
        />
      </CardContent>
    </Card>
  );
}
