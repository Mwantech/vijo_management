import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { DateRangeProvider } from './context/DateRangeContext'
import './index.css'
const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:60_000,gcTime:10*60_000,retry:1,refetchOnWindowFocus:false}}})
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><QueryClientProvider client={queryClient}><AuthProvider><DateRangeProvider><App/></DateRangeProvider></AuthProvider></QueryClientProvider></BrowserRouter></StrictMode>)
