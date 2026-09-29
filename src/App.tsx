import { lazy,Suspense } from 'react'
import { Navigate,Route,Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ProtectedRoute } from './components/common/ProtectedRoute'
import { SectionLoading } from './components/common/SectionState'
import { useAuth } from './context/AuthContext'
const MembershipsPage=lazy(()=>import('./pages/MembershipsPage').then(m=>({default:m.MembershipsPage})))
const MembershipDetailsPage=lazy(()=>import('./pages/MembershipsPage').then(m=>({default:m.MembershipDetailsPage})))
const MembershipContentPage=lazy(()=>import('./pages/MembershipsPage').then(m=>({default:m.MembershipContentPage})))
const PaymentServicePage=lazy(()=>import('./pages/PaymentServicePage').then(m=>({default:m.PaymentServicePage})))
const DashboardPage=lazy(()=>import('./pages/DashboardPage').then(m=>({default:m.DashboardPage})))
const UsersPage=lazy(()=>import('./pages/UsersPage').then(m=>({default:m.UsersPage})))
const UserDetailsPage=lazy(()=>import('./pages/UserDetailsPage').then(m=>({default:m.UserDetailsPage})))
const PlatformPage=lazy(()=>import('./pages/PlatformPage').then(m=>({default:m.PlatformPage})))
const RevenuePage=lazy(()=>import('./pages/RevenuePage').then(m=>({default:m.RevenuePage})))
const GrowthPage=lazy(()=>import('./pages/GrowthPage').then(m=>({default:m.GrowthPage})))
const ActivityPage=lazy(()=>import('./pages/ActivityPage').then(m=>({default:m.ActivityPage})))
const SystemStatusPage=lazy(()=>import('./pages/SystemStatusPage').then(m=>({default:m.SystemStatusPage})))
const SubscriptionsPage=lazy(()=>import('./pages/SubscriptionsPage').then(m=>({default:m.SubscriptionsPage})))
const TransactionsPage=lazy(()=>import('./pages/TransactionsPage').then(m=>({default:m.TransactionsPage})))
const SettingsPage=lazy(()=>import('./pages/SettingsPage').then(m=>({default:m.SettingsPage})))
const NotFoundPage=lazy(()=>import('./pages/NotFoundPage').then(m=>({default:m.NotFoundPage})))
function Home(){const{user}=useAuth();return <Navigate to={user.role==='finance'?'/revenue':user.role==='support'?'/users':'/dashboard'} replace/>}

export default function App(){return <Suspense fallback={<SectionLoading rows={8}/>}><Routes><Route element={<AppShell/>}><Route index element={<Home/>}/><Route path="dashboard" element={<ProtectedRoute permission="analytics:view"><DashboardPage/></ProtectedRoute>}/><Route path="users" element={<ProtectedRoute permission="users:view"><UsersPage/></ProtectedRoute>}/><Route path="users/:id" element={<ProtectedRoute permission="users:view"><UserDetailsPage/></ProtectedRoute>}/><Route path="platforms/:id" element={<ProtectedRoute permission="analytics:view"><PlatformPage/></ProtectedRoute>}/><Route path="memberships" element={<ProtectedRoute permission="revenue:view"><MembershipsPage/></ProtectedRoute>}/><Route path="memberships/:id" element={<ProtectedRoute permission="revenue:view"><MembershipDetailsPage/></ProtectedRoute>}/><Route path="membership-content" element={<ProtectedRoute permission="revenue:view"><MembershipContentPage/></ProtectedRoute>}/><Route path="payments" element={<ProtectedRoute permission="revenue:view"><PaymentServicePage/></ProtectedRoute>}/><Route path="payments/transactions" element={<ProtectedRoute permission="revenue:view"><PaymentServicePage ledger/></ProtectedRoute>}/><Route path="revenue" element={<ProtectedRoute permission="revenue:view"><RevenuePage/></ProtectedRoute>}/><Route path="growth" element={<ProtectedRoute permission="analytics:view"><GrowthPage/></ProtectedRoute>}/><Route path="activity" element={<ProtectedRoute permission="activity:view"><ActivityPage/></ProtectedRoute>}/><Route path="subscriptions" element={<ProtectedRoute permission="revenue:view"><SubscriptionsPage/></ProtectedRoute>}/><Route path="transactions" element={<ProtectedRoute permission="revenue:view"><TransactionsPage/></ProtectedRoute>}/><Route path="system" element={<ProtectedRoute permission="system:view"><SystemStatusPage/></ProtectedRoute>}/><Route path="settings" element={<ProtectedRoute permission="settings:manage"><SettingsPage/></ProtectedRoute>}/><Route path="*" element={<NotFoundPage/>}/></Route></Routes></Suspense>}
