import { useState, useCallback, useRef, useMemo } from 'react';

// ====================================================================
// v3.7.1 AI Hook — 通用 OpenAI 兼容协议调用封装
// 任意 OpenAI 兼容服务都可接入：通义千问 / DeepSeek / OpenAI / Moonshot / 智谱 GLM 等
// 切换模型只需换 Base URL + Model + API Key，无需改代码
//
// v3.8.0 多模态扩展：
// - chat() 接收 OpenAI 多模态 content 格式（字符串 | 数组）
// - 新增 generateImageReview / playlistFromImage
// 兼容：纯文本 AIMessage 仍可传字符串 content（自动按原样转发）
//
// v3.8.5 文本类扩展：
// - interpretLyrics 歌词深度解读（逐段讲解含义/背景/情感）
// - continuePlaylist 歌单续写（基于现有歌单续写 10 首相似风格）
// - analyzeMoodDiary 心情日记（分析今日听歌记录的心情）
// - appreciateSong 歌曲鉴赏陪听解说（像音乐老师陪听）
// ====================================================================

// 纯文本消息（v3.7.0 老接口，A1/A2/A4/A5/A6 继续用）
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// 多模态消息（v3.8.0 新增，content 是数组，支持 text/image_url/input_audio）
export type MultimodalContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
      | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }
    >;

export interface MultimodalMessage {
  role: 'system' | 'user' | 'assistant';
  content: MultimodalContent;
}

export function useAI(apiBase: string, apiKey: string, aiBaseUrl: string, aiModel: string) {
  const [loading, setLoading] = useState(false);
  // 防并发：同一时间只允许一个 AI 请求（避免额度浪费 + UI 混乱）
  const lockRef = useRef(false);

  // v3.8.0: chat() 升级支持多模态 messages（MultimodalMessage[]）
  // 兼容老接口：传 AIMessage[]（content 是字符串）也照常工作
  const chat = useCallback(async (messages: MultimodalMessage[] | AIMessage[], opts?: { maxTokens?: number; temperature?: number }) => {
    if (!apiKey) throw new Error('NO_API_KEY');
    if (!apiBase) throw new Error('NO_SERVER');
    if (!aiBaseUrl) throw new Error('NO_BASE_URL');
    if (!aiModel) throw new Error('NO_MODEL');
    if (lockRef.current) throw new Error('BUSY');
    lockRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          baseUrl: aiBaseUrl,
          model: aiModel,
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
  }, [apiBase, apiKey, aiBaseUrl, aiModel]);

  // ============ A1-A6 原有方法（纯文本，不变）============

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

  // ============ v3.8.0 多模态新方法 ============

  // C2 封面意境解读：看封面图 + 歌曲信息 → 视觉+音乐融合解读（150 字以内）
  const generateImageReview = useCallback(async (imageDataUrl: string, song: { title: string; artist: string }) => {
    const msg: MultimodalMessage[] = [
      {
        role: 'system',
        content: '你同时看专辑封面图和歌曲信息，写一段"封面视觉 × 歌曲意境"融合解读。语言自然有画面感，像朋友描述看到封面的感受+听到歌的联想。150字以内，不要小标题，不要引号，直接输出正文。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `歌曲《${song.title}》- ${song.artist}。请看封面图并融合歌曲信息写一段解读。` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ];
    return chat(msg, { maxTokens: 400, temperature: 0.85 });
  }, [chat]);

  // C3 照片心情电台（v3.8.4 升级）：看照片深度分析氛围/场景/情绪 → 直接生成 15 首贴合的真实歌曲列表
  // 不再走"生成单一关键词 → 搜网易云"的浅路径，歌单更丰富更贴照片情绪
  const playlistFromImage = useCallback(async (imageDataUrl: string) => {
    const msg: MultimodalMessage[] = [
      {
        role: 'system',
        content: '你是音乐策展人。看用户上传的照片，深度感受画面的氛围、场景、时间段、情绪、色调、风格，然后推荐15首真实存在、贴合照片氛围的歌曲（中文歌和英文歌都可，可跨年代跨语种）。每行一首，格式"歌名 - 歌手"。只输出列表，不要编号、不要解释、不要前后缀。这些歌必须是真实存在且知名的，方便在网易云搜索到。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请看这张照片，深度感受它的氛围和情绪，推荐15首贴合的歌曲列表。' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ];
    return chat(msg, { maxTokens: 700, temperature: 0.85 });
  }, [chat]);

  // ============ v3.8.5 文本类扩展方法 ============

  // A7 AI 歌词深度解读：逐段解读歌词含义/创作背景/情感/隐喻（300 字以内）
  const interpretLyrics = useCallback(async (lyrics: string, song: { title: string; artist: string }) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐文学专家，擅长深度解读歌词。用户会给你歌词文本和歌曲信息，请逐段解读歌词的含义、创作背景、歌手想表达的情感、有隐喻的句子要点明。像音乐老师讲解一样自然，不要用 markdown 标题，用段落分隔。300字以内。' },
      { role: 'user', content: `歌曲《${song.title}》- ${song.artist}\n\n歌词：\n${lyrics}` },
    ];
    return chat(msg, { maxTokens: 600, temperature: 0.7 });
  }, [chat]);

  // A8 AI 歌单续写：基于现有歌单续写 10 首相似风格的真实歌曲
  const continuePlaylist = useCallback(async (existingList: string) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐策展人。用户给你一个现有歌单，请分析其风格和氛围，续写推荐10首风格相似的真实歌曲（中文歌和英文歌都可）。每行一首，格式"歌名 - 歌手"。只输出列表，不要编号、不要解释、不要前后缀。' },
      { role: 'user', content: `现有歌单：\n${existingList}` },
    ];
    return chat(msg, { maxTokens: 400, temperature: 0.8 });
  }, [chat]);

  // A9 AI 心情日记：根据今日听歌记录分析心情变化与情绪状态（150 字以内）
  const analyzeMoodDiary = useCallback(async (todaySongs: string) => {
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐心理分析师。用户给你今天听过的歌曲列表，请分析用户今天的心情变化和情绪状态。像写日记一样自然地描述，包括：整体情绪、可能的情绪起伏、音乐选择的暗示。150字以内，不要用 markdown 标题，用段落分隔。' },
      { role: 'user', content: `今天听过的歌曲：\n${todaySongs}` },
    ];
    return chat(msg, { maxTokens: 300, temperature: 0.75 });
  }, [chat]);

  // A10 AI 歌曲鉴赏陪听：像音乐老师在旁陪听一样给出解说词（200 字以内）
  // v3.8.6: 改为独立 fetch，不走 lockRef 锁，避免被其他 AI 调用阻塞
  const appreciateSong = useCallback(async (song: { title: string; artist: string; album?: string }) => {
    if (!apiKey) throw new Error('NO_API_KEY');
    if (!apiBase) throw new Error('NO_SERVER');
    if (!aiBaseUrl) throw new Error('NO_BASE_URL');
    if (!aiModel) throw new Error('NO_MODEL');
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐鉴赏老师，用户正在听一首歌，请像陪听一样给出解说词。包括：这首歌的风格特点、编曲亮点、歌手演绎特色、值得注意的段落。像朋友在旁边轻声解说，不要用 markdown 标题或列表符号，用段落分隔。200字以内。' },
      { role: 'user', content: `请为歌曲《${song.title}》- ${song.artist}${song.album ? `（专辑《${song.album}》）` : ''}给出陪听解说词。` },
    ];
    const res = await fetch(`${apiBase}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        baseUrl: aiBaseUrl,
        model: aiModel,
        messages: msg,
        maxTokens: 400,
        temperature: 0.8,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.content || '').trim();
  }, [apiKey, apiBase, aiBaseUrl, aiModel]);

  // v3.8.6: 分享卡片专用音乐解读（30-50 字，简短一行点评）
  // 独立实现，不走 lockRef 锁，避免和鉴赏模式冲突
  const shareCardCaptionAI = useCallback(async (song: { title: string; artist: string; album?: string }) => {
    if (!apiKey) throw new Error('NO_API_KEY');
    if (!apiBase) throw new Error('NO_SERVER');
    if (!aiBaseUrl) throw new Error('NO_BASE_URL');
    if (!aiModel) throw new Error('NO_MODEL');
    const msg: AIMessage[] = [
      { role: 'system', content: '你是音乐评论家。请用一句话（30-50 字以内）点评这首歌的音乐特色、情感或亮点，纯文字不带任何符号格式，适合分享卡片显示。' },
      { role: 'user', content: `请为歌曲《${song.title}》- ${song.artist}给出 30-50 字的简短点评。` },
    ];
    const res = await fetch(`${apiBase}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        baseUrl: aiBaseUrl,
        model: aiModel,
        messages: msg,
        maxTokens: 100,
        temperature: 0.8,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.content || data.message || '').trim();
  }, [apiKey, apiBase, aiBaseUrl, aiModel]);

  // v3.8.6 修复：用 useMemo 稳定返回对象，避免下游 effect 依赖 ai 对象时每次 render 都重跑
  // （之前返回普通对象，依赖 ai 的 useEffect 每次 render 都重跑，导致 cancelled=true 永远走不进 then）
  return useMemo(() => ({
    loading,
    chat,
    // v3.7.0 文本类
    generateReview,
    extractSearchKeyword,
    moodToKeywords,
    generatePlaylist,
    chatMusic,
    // v3.8.0 多模态类
    generateImageReview,
    // v3.8.4 C3 升级：看图生成歌单
    playlistFromImage,
    // v3.8.5 文本类扩展
    interpretLyrics,
    continuePlaylist,
    analyzeMoodDiary,
    appreciateSong,
    // v3.8.6 分享卡片专用
    shareCardCaptionAI,
  }), [
    loading, chat, generateReview, extractSearchKeyword, moodToKeywords,
    generatePlaylist, chatMusic, generateImageReview, playlistFromImage,
    interpretLyrics, continuePlaylist, analyzeMoodDiary, appreciateSong, shareCardCaptionAI,
  ]);
}
