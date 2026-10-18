import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import SignInScreen from './app/screens/SignInScreen';
import CameraScreen from './app/screens/CameraScreen';

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

// Signed out -> sign in. Signed in -> straight to the camera.
function Root() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;

  return <CameraScreen />;
}
