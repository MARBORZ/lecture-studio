import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import { MotionRoot } from './components/motion'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      <RouterProvider router={router} />
    </MotionRoot>
  </StrictMode>,
)
