import React, {useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import {apiClient, UserCreate, UserRole} from '../api';
import {describeError} from '../api/errors';
import FormField from '../components/FormField';
import PrimaryButton from '../components/PrimaryButton';
import RoleSelector from '../components/RoleSelector';

interface SignUpScreenProps {
  onSignedUp: (email: string) => void;
  onGoToLogin: () => void;
}

function validate(form: UserCreate): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\S+@\S+\.\S+$/.test(form.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (form.name.trim().length < 1) {
    errors.name = 'Name is required.';
  }
  if (form.password.length < 12) {
    errors.password = 'Password must be at least 12 characters.';
  }
  return errors;
}

function SignUpScreen({onSignedUp, onGoToLogin}: SignUpScreenProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(['student']);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const form: UserCreate = {
      email: email.trim(),
      name: name.trim(),
      password,
      roles,
    };

    const clientErrors = validate(form);
    setFieldErrors(clientErrors);
    setGeneralError(null);
    if (Object.keys(clientErrors).length > 0) {
      return;
    }

    setLoading(true);
    try {
      await apiClient.createUser(form);
      Alert.alert('Account created', 'You can now log in with your new account.');
      onSignedUp(form.email);
    } catch (error) {
      const {message, fieldErrors: serverFieldErrors} = describeError(error);
      setFieldErrors(serverFieldErrors);
      setGeneralError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create account</Text>
        {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}
        <FormField
          label="Name"
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
          placeholder="Jane Doe"
        />
        <FormField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          placeholder="jane@example.com"
          keyboardType="email-address"
        />
        <FormField
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          placeholder="At least 12 characters"
          secureTextEntry
        />
        <Text style={styles.label}>Roles</Text>
        <RoleSelector selected={roles} onChange={setRoles} />
        <PrimaryButton title="Sign up" onPress={handleSubmit} loading={loading} />
        <PrimaryButton
          title="Already have an account? Log in"
          onPress={onGoToLogin}
          variant="secondary"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  content: {padding: 20},
  title: {fontSize: 24, fontWeight: '700', marginBottom: 16, color: '#1c1c1e'},
  label: {marginBottom: 6, fontSize: 14, fontWeight: '600', color: '#1c1c1e'},
  generalError: {color: '#d70015', marginBottom: 12, fontSize: 14},
});

export default SignUpScreen;
