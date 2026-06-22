import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Landing from './pages/Landing'
import SignUp from './pages/SignUp'
import Login from './pages/Login'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Bookshelf from './pages/Bookshelf'
import StoryPrompts from './pages/StoryPrompts'
import GeneratingStory from './pages/GeneratingStory'
import BedtimeRoutine from './pages/BedtimeRoutine'
import StoryReader from './pages/StoryReader'

const Protected = ({ children }) => <ProtectedRoute>{children}</ProtectedRoute>

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify" element={<VerifyEmail />} />

          {/* Protected */}
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/child/:childId/bookshelf" element={<Protected><Bookshelf /></Protected>} />
          <Route path="/child/:childId/prompts" element={<Protected><StoryPrompts /></Protected>} />
          <Route path="/child/:childId/story/:storyId/bedtime" element={<Protected><BedtimeRoutine /></Protected>} />
          <Route path="/story/:storyId/generating" element={<Protected><GeneratingStory /></Protected>} />
          <Route path="/story/:storyId/read" element={<Protected><StoryReader /></Protected>} />

          {/* Default */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
