'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { ARTICLE_PREFIXES, ARTICLES_PATH, deleteArticle } from '../api';
import type { Article, ArticlesPage } from '../types';
import { ArticleForm } from './ArticleEditor';

/* Writing and deleting an article, from the knowledge screen or from the reader opened in the composer's knowledge
   search (the old edit-article / delete-article actions). */

export function useArticleActions() {
  const client = useQueryClient();
  const refresh = useInvalidate();
  const toast = useToast();
  const { openModal, confirmDelete } = useDialogs();

  /** Open the editor: a new article, or `article`; `onSaved` runs after saving (the knowledge screen reopens it). */
  const edit = useCallback(
    (article?: Article, onSaved?: (id: string) => unknown) => {
      const list = client.getQueryData<ArticlesPage>([ARTICLES_PATH])?.articles ?? [];
      const categories = [...new Set(list.map((a) => a.category))];
      openModal(article ? 'แก้ไขบทความ' : 'เขียนบทความใหม่', <ArticleForm article={article} categories={categories} onSaved={onSaved} />, {
        wide: true,
      });
    },
    [client, openModal],
  );

  const remove = useCallback(
    (article: Article) =>
      confirmDelete({
        title: 'ลบบทความ',
        warning: `“${article.title}” จะถูกย้ายไปถังขยะ`,
        effects: [
          'บทความจะหายจากคลังความรู้ของทีมทันที',
          ...(article.visibility === 'public' ? ['ลูกค้าจะไม่เห็นบทความนี้ในหน้าลูกค้าอีกต่อไป'] : []),
          'กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร',
          'การลบจะถูกบันทึกในประวัติการทำงาน',
        ],
        confirmLabel: 'ย้ายบทความไปถังขยะ',
        run: async () => {
          await deleteArticle(article.id);
          toast('ย้ายบทความไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ');
          await refresh(...ARTICLE_PREFIXES);
        },
      }),
    [confirmDelete, toast, refresh],
  );

  return { edit, remove };
}
