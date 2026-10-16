import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '@/layouts/AppShell'
import { DiaryPage } from '@/pages/DiaryPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { NotebookChatPage } from '@/pages/NotebookChatPage'
import { NotFound, RouteError } from '@/pages/NotFound'
import { VideosPage } from '@/pages/VideosPage'
import { StudioPage } from '@/pages/StudioPage'
import { LessonLayout } from '@/pages/lesson/LessonLayout'
import { LessonAssistant, LessonFiles, LessonNotes, LessonTranscript } from '@/pages/lesson/tabs'
import { HotkeysSettings } from '@/features/hotkeys/HotkeysSettings'
import { SettingsLayout } from '@/pages/settings/SettingsLayout'
import { AISettingsSection, InterfaceSettings, PathsSettings, ProcessingSettings, PromptsSettings } from '@/pages/settings/sections'
import { AppProvider } from './AppProvider'

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <AppProvider>
        <AppShell />
      </AppProvider>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'library/:projectId', element: <LibraryPage /> },
      { path: 'notebooks/:projectId/chat', element: <NotebookChatPage /> },
      {
        path: 'lessons/:lessonId',
        element: <LessonLayout />,
        children: [
          { index: true, element: <Navigate to="notes" replace /> },
          { path: 'notes', element: <LessonNotes /> },
          { path: 'transcript', element: <LessonTranscript /> },
          { path: 'assistant', element: <LessonAssistant /> },
          { path: 'files', element: <LessonFiles /> },
        ],
      },
      { path: 'studio', element: <StudioPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'diary', element: <DiaryPage /> },
      { path: 'diary/:category', element: <DiaryPage /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="paths" replace /> },
          { path: 'paths', element: <PathsSettings /> },
          { path: 'ai', element: <AISettingsSection /> },
          { path: 'prompts', element: <PromptsSettings /> },
          { path: 'processing', element: <ProcessingSettings /> },
          { path: 'interface', element: <InterfaceSettings /> },
          { path: 'hotkeys', element: <HotkeysSettings /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
