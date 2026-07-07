import { useState, useCallback, useRef } from 'react';

// ====================================================================
// v3.7.0 AI Hook — 通义千问 Qwen-Turbo 调用封装
// 每天免费 100 万 tokens，兼容 OpenAI 格式，server.js /api/ai/chat 代理
// 服务 5 个功能：A1 乐评 / A2 自然语言搜歌 / A4 心情电台 / A5 歌单生成 / A6 音乐问答
// ====================================================================

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function useAI(apiBase: string, apiKey: string) {
  const [loading, setLoading] = useState(false);
  // 防并发：同一时间只允许一个 AI 请求（避免额度浪费 + UI 混乱）
  const lockRef = useRef(false);

  const chat = useCallback(async (messages: AIMessage[], opts?: { maxTokens?: number; temperature?: number }) => {
    if (!apiKey) throw new Error('NO_API_KEY');
    if (!apiBase) throw new Error('NO_SERVER');
    if (lockRef.current) throw new Error('BUSY');
    lockRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          messages,
          maxTokens: opts?.maxTokens ?? 1024,
          temperature: opts?.temperature ?? 0.7,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return (data.content || '').trim();
    } finally {
      lockRef.current = false;
      setLoading(false);
    }
  }, [apiBase, apiKey]);

  // A1 AI 乐评：生成沉浸式短乐评（150 字以内，像朋友分享听后感）
  const generateReview = useCallback(async (song: { title: string; artist: string; album?: string }) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你是资深乐评人，擅长用沉浸式、富有画面感的语言写短乐评。不堆砌辞藻，有真实感受，像朋友分享听后感。150字以内，不要小标题不要引号，直接输出正文。' },
      { role: 'user', content: `请为歌曲《${song.title}》- ${song.artist}${song.album ? `（专辑《${song.album}》）` : ''}写一段乐评。` },
    ];
    return chat(msg, { maxTokens: 400, temperature: 0.85 });
  }, [chat]);

  // A2 自然语言搜歌：把描述转成网易云搜索关键词
  const extractSearchKeyword = useCallback(async (query: string) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你把用户的自然语言音乐需求转换成网易云搜索关键词。只输出关键词本身（可用空格分词），不要引号、不要解释、不要标点、不要句号。例如"想听适合深夜emo的歌"输出"深夜 伤感"，"周杰伦快的歌"输出"周杰伦 快歌"。最多12个字。' },
      { role: 'user', content: query },
    ];
    return chat(msg, { maxTokens: 60, temperature: 0.3 }).then(s =>
      s.trim().replace(/^["'"']+|["'"']+$/g, '').replace(/[。，,.!?！？]/g, '').trim()
    );
  }, [chat]);

  // A4 AI 心情电台：根据心情描述生成搜索关键词
  const moodToKeywords = useCallback(async (mood: string) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你根据用户的心情描述，推荐一个适合的音乐搜索关键词（网易云搜索用）。只输出关键词本身，不要引号、不要解释、不要标点。例如"心情低落想被治愈"输出"治愈 温暖"，"想振奋起来"输出"励志 摇滚"。' },
      { role: 'user', content: `心情：${mood}` },
    ];
    return chat(msg, { maxTokens: 60, temperature: 0.6 }).then(s =>
      s.trim().replace(/^["'"']+|["'"']+$/g, '').replace(/[。，,.!?！？]/g, '').trim()
    );
  }, [chat]);

  // A5 AI 歌单生成：根据主题生成 20 首真实歌曲名列表
  const generatePlaylist = useCallback(async (theme: string) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐策展人。根据主题推荐20首真实存在的歌曲（中文歌和英文歌都可），每行一首，格式"歌名 - 歌手"。只输出列表，不要编号、不要解释、不要前后缀。这些歌必须是真实存在且知名的，方便在网易云搜索到。' },
      { role: 'user', content: `主题：${theme}` },
    ];
    return chat(msg, { maxTokens: 800, temperature: 0.8 });
  }, [chat]);

  // A6 AI 音乐问答陪伴：多轮对话
  const chatMusic = useCallback(async (history: AIMessage[], userMsg: string, context?: string) => {
    const sys: AIMessage = {
      role: 'system',
      content: `你是 AuroraBeat 的音乐陪伴助手，温柔、有品味、懂音乐。用简短自然的口吻回答（一般2-4句，不超过6句）。${context ? `用户当前正在听：${context}。` : ''}可以聊音乐、推荐歌、解读歌词、分享听歌感受。不要用 markdown 标题或列表符号，像聊天一样自然。`,
    };
    const msgs: AIMessage[] = [sys, ...history.slice(-8), { role: 'user', content: userMsg }];
    return chat(msgs, { maxTokens: 300, temperature: 0.8 });
  }, [chat]);

  return { loading, chat, generateReview, extractSearchKeyword, moodToKeywords, generatePlaylist, chatMusic };
}
