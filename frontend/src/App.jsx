import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MemberPage from './pages/MemberPage';
import ReviewPage from './pages/ReviewPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/join/:token" element={<MemberPage />} />
        <Route path="/review/:formId" element={<ReviewPage />} />
        {/* Redirect root to a token for testing purposes */}
        <Route path="/" element={<Navigate to="/join/mock-token-123" replace />} />
      </Routes>
    </Router>
  );
}

export default App;