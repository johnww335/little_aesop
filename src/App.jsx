import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import SignUp from './pages/SignUp'
import Login from './pages/Login'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Bookshelf from './pages/Bookshelf'
import StoryPrompts from './pages/StoryPrompts'
import GeneratingStory from './pages/GeneratingStory'
import StoryReader from './pages/StoryReader'

const Protected = ({ children }) => <ProtectedRoute>{children}</ProtectedRoute>

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify" element={<VerifyEmail />} />

          {/* Protected */}
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/child/:childId/bookshelf" element={<Protected><Bookshelf /></Protected>} />
          <Route path="/child/:childId/prompts" element={<Protected><StoryPrompts /></Protected>} />
          <Route path="/story/:storyId/generating" element={<Protected><GeneratingStory /></Protected>} />
          <Route path="/story/:storyId/read" element={<Protected><StoryReader /></Protected>} />

          {/* Default */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
