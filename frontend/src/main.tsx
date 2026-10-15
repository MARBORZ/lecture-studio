import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { domMax, LazyMotion, MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router'
import { router } from './app/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* One motion setup for the app: lazy feature bundle (layout animations included), OS reduced-motion respected. */}
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
)
