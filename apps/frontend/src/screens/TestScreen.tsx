import React, {useState} from 'react';

import LoginScreen from './LoginScreen';
import ProfileScreen from './ProfileScreen';
import SignUpScreen from './SignUpScreen';
import {useAppContext} from '../state/AppContext';

type AuthRoute = 'login' | 'signup';

function TestScreen() {
  const {isAuthenticated} = useAppContext();
  const [authRoute, setAuthRoute] = useState<AuthRoute>('login');
  const [prefillEmail, setPrefillEmail] = useState('');

  if (isAuthenticated) {
    return <ProfileScreen />;
  }

  if (authRoute === 'signup') {
    return (
      <SignUpScreen
        onSignedUp={email => {
          setPrefillEmail(email);
          setAuthRoute('login');
        }}
        onGoToLogin={() => setAuthRoute('login')}
      />
    );
  }

  return (
    <LoginScreen
      initialEmail={prefillEmail}
      onGoToSignUp={() => setAuthRoute('signup')}
    />
  );
}

export default TestScreen;
