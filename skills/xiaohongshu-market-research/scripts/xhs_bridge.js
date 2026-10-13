export const BRIDGE_SOURCE = `
(({ imageFormats, imageFormatsQuery }) => {
  if (window.__xhsBridge) return;

  const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null);
  const unwrapResponse = (response) => {
    if (response && typeof response === 'object' && response.data && typeof response.data === 'object') return response.data;
    return response || {};
  };
  const normalizeSearchResult = (response) => {
    const payload = unwrapResponse(response);
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      hasMore: Boolean(pickFirst(payload.hasMore, payload.has_more, false)),
      searchId: pickFirst(payload.searchId, payload.search_id, '') || '',
    };
  };
  const normalizeFeedResult = (response) => {
    const payload = unwrapResponse(response);
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  };
  const normalizeCommentResult = (response) => {
    const payload = unwrapResponse(response);
    return {
      comments: Array.isArray(payload.comments) ? payload.comments : [],
      cursor: pickFirst(payload.cursor, '') || '',
      hasMore: Boolean(pickFirst(payload.hasMore, payload.has_more, false)),
    };
  };
  const toPlainComment = (comment) => ({
    id: comment.id,
    content: comment.content,
    likeCount: pickFirst(comment.likeCount, comment.like_count, ''),
    subCommentCount: pickFirst(comment.subCommentCount, comment.sub_comment_count, ''),
    createTime: pickFirst(comment.createTime, comment.create_time, ''),
    ipLocation: pickFirst(comment.ipLocation, comment.ip_location, ''),
    user: pickFirst(comment.userInfo, comment.user_info, comment.user)
      ? {
          userId: pickFirst(comment.userInfo?.userId, comment.userInfo?.user_id, comment.user_info?.userId, comment.user_info?.user_id, comment.user?.userId, comment.user?.user_id, ''),
          nickname: pickFirst(comment.userInfo?.nickname, comment.userInfo?.nick_name, comment.user_info?.nickname, comment.user_info?.nick_name, comment.user?.nickname, comment.user?.nick_name, ''),
          image: pickFirst(comment.userInfo?.image, comment.userInfo?.avatar, comment.user_info?.image, comment.user_info?.avatar, comment.user?.image, comment.user?.avatar, ''),
        }
      : null,
  });

  const getReq = () => {
    if (window.__xhsReq) return window.__xhsReq;
    window.webpackChunkxhs_pc_web.push([[Symbol('ctf_req')], {}, (req) => { window.__xhsReq = req; }]);
    return window.__xhsReq;
  };

  const API_TARGETS = {
    search: {
      names: ['getAiSearchNotesV2', 'postApiSnsWebV1SearchNotes'],
      sourceHints: ['WEB_AI_SEARCH_NOTES_V2', '/api/sns/web/v2/search/notes', '/api/sns/web/v1/search/notes'],
    },
    note: {
      names: ['postApiSnsWebV1Feed'],
      sourceHints: ['/api/sns/web/v1/feed'],
    },
    comments: {
      names: ['getApiSnsWebV2CommentPage'],
      sourceHints: ['/api/sns/web/v2/comment/page'],
    },
    subComments: {
      names: ['getApiSnsWebV2CommentSubPage'],
      sourceHints: ['/api/sns/web/v2/comment/sub/page'],
    },
  };
  const matchesApi = (target, fn) => {
    if (target.names.includes(fn.name)) return true;
    const source = Function.prototype.toString.call(fn);
    return target.sourceHints.some((hint) => source.includes(hint));
  };

  const getApi = () => {
    if (window.__xhsApi) return window.__xhsApi;
    const req = getReq();
    const resolved = {};

    for (const id of Object.keys(req.m)) {
      try {
        const mod = req(id);
        for (const [key, value] of Object.entries(mod)) {
          if (typeof value !== 'function') continue;
          for (const [targetKey, target] of Object.entries(API_TARGETS)) {
            if (resolved[targetKey]) continue;
            if (!matchesApi(target, value)) continue;
            resolved[targetKey] = { key, module: mod, name: value.name || targetKey };
          }
        }
        if (resolved.search && resolved.note && resolved.comments && resolved.subComments) break;
      } catch (error) {
        void error;
      }
    }

    if (resolved.search && resolved.note && resolved.comments && resolved.subComments) {
      window.__xhsApi = resolved;
      return window.__xhsApi;
    }

    throw new Error('未找到小红书 API 模块');
  };

  const fetchSubComments = async (api, noteId, xsecToken, rootCommentId, limit) => {
    const results = [];
    let cursor = '';
    while (results.length < limit) {
      const res = normalizeCommentResult(await api.subComments.module[api.subComments.key]({
        params: {
          noteId,
          rootCommentId,
          num: Math.min(10, limit - results.length),
          cursor,
          imageFormats: imageFormatsQuery,
          topCommentId: '',
          xsecToken,
        },
      }));
      const batch = res.comments.slice(0, limit - results.length).map(toPlainComment);
      results.push(...batch);
      if (!res.hasMore || !res.cursor || batch.length === 0) break;
      cursor = res.cursor;
    }
    return results;
  };

  window.__xhsBridge = {
    async searchNotes(options) {
      const api = getApi();
      return normalizeSearchResult(await api.search.module[api.search.key]({
        keyword: options.keyword,
        page: 1,
        pageSize: options.pageSize,
        searchId: options.searchId,
        sessionId: options.sessionId,
        sort: 'general',
        noteType: 0,
        extFlags: [],
        filters: [],
        geo: '',
        imageFormats,
      }));
    },
    async fetchNoteDetail(options) {
      const api = getApi();
      return normalizeFeedResult(await api.note.module[api.note.key](
        {
          sourceNoteId: options.noteId,
          imageFormats,
          extra: { needBodyTopic: '1' },
          xsecSource: 'pc_search',
          xsecToken: options.xsecToken,
        },
        { headers: { 'xy-direction': '' } },
      ));
    },
    async fetchComments(options) {
      const api = getApi();
      const comments = [];
      let cursor = '';
      while (comments.length < options.commentLimit) {
        const res = normalizeCommentResult(await api.comments.module[api.comments.key]({
          params: {
            noteId: options.noteId,
            cursor,
            topCommentId: '',
            imageFormats: imageFormatsQuery,
            xsecToken: options.xsecToken,
          },
        }));
        const batch = res.comments.slice(0, options.commentLimit - comments.length);
        for (const comment of batch) {
          const current = toPlainComment(comment);
          if (Number(pickFirst(comment.subCommentCount, comment.sub_comment_count, 0)) > 0 && options.subCommentLimit > 0) {
            current.subComments = await fetchSubComments(
              api,
              options.noteId,
              options.xsecToken,
              comment.id,
              options.subCommentLimit,
            );
          } else {
            current.subComments = [];
          }
          comments.push(current);
        }
        if (!res.hasMore || !res.cursor || batch.length === 0) break;
        cursor = res.cursor;
      }
      return comments;
    },
  };
})`;
