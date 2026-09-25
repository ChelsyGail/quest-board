import React, {useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import {apiClient, UserRole, UserUpdate} from '../api';
import {describeError} from '../api/errors';
import FormField from '../components/FormField';
import PrimaryButton from '../components/PrimaryButton';
import RoleSelector from '../components/RoleSelector';
import {useAppContext} from '../state/AppContext';

function ProfileScreen() {
  const {currentUser, setCurrentUser, logout} = useAppContext();
  const [userId, setUserId] = useState(currentUser?.id ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setFieldErrors({});
    setGeneralError(null);

    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      setFieldErrors({user_id: 'Enter the numeric ID of the user to update.'});
      return;
    }

    const update: UserUpdate = {};
    if (name.trim()) {
      update.name = name.trim();
    }
    if (email.trim()) {
      update.email = email.trim();
    }
    if (password) {
      update.password = password;
    }
    if (roles.length > 0) {
      update.roles = roles;
    }

    if (Object.keys(update).length === 0) {
      setGeneralError('Change at least one field before saving.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.updateUser(parsedUserId, update);
      if (response.data && !Array.isArray(response.data)) {
        setCurrentUser(response.data);
      }
      setPassword('');
      Alert.alert('Profile updated', 'The user was updated successfully.');
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
        <Text style={styles.title}>Update profile</Text>
        {currentUser ? (
          <Text style={styles.subtitle}>
            Signed in as {currentUser.attributes.email} (ID {currentUser.id})
          </Text>
        ) : null}
        {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}
        <FormField
          label="User ID"
          value={String(userId)}
          onChangeText={setUserId}
          error={fieldErrors.user_id}
          keyboardType="number-pad"
          placeholder="e.g. 1"
        />
        <FormField
          label="Name"
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
          placeholder="Leave blank to keep current name"
        />
        <FormField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          placeholder="Leave blank to keep current email"
          keyboardType="email-address"
        />
        <FormField
          label="New password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          placeholder="Leave blank to keep current password"
          secureTextEntry
        />
        <Text style={styles.label}>Roles (leave empty to keep current roles)</Text>
        <RoleSelector selected={roles} onChange={setRoles} />
        <PrimaryButton title="Save changes" onPress={handleSubmit} loading={loading} />
        <PrimaryButton title="Log out" onPress={logout} variant="secondary" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  content: {padding: 20},
  title: {fontSize: 24, fontWeight: '700', marginBottom: 8, color: '#1c1c1e'},
  subtitle: {fontSize: 14, color: '#3a3a3c', marginBottom: 16},
  label: {marginBottom: 6, fontSize: 14, fontWeight: '600', color: '#1c1c1e'},
  generalError: {color: '#d70015', marginBottom: 12, fontSize: 14},
});

export default ProfileScreen;
