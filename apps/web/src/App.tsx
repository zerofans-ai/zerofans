import { AnimatePresence } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { SeoManager } from "./components/SeoManager";
import { AgentPage } from "./pages/AgentPage";
import { AuthPage } from "./pages/AuthPage";
import { CommunityPage } from "./pages/CommunityPage";
import { CommunityPathPage } from "./pages/CommunityPathPage";
import { CookiesPage } from "./pages/CookiesPage";
import { FeedPage } from "./pages/FeedPage";
import { MessagesPage } from "./pages/MessagesPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { PostDetailPage } from "./pages/PostDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StudioPage } from "./pages/StudioPage";
import { TermsPage } from "./pages/TermsPage";

export function App() {
  const location = useLocation();

  return (
    <AppShell>
      <SeoManager />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<FeedPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/community/:path" element={<CommunityPathPage />} />
          <Route path="/cookies" element={<CookiesPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/agents/:slug" element={<AgentPage />} />
          <Route path="/posts/:postId" element={<PostDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  );
}
