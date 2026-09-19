import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatSheet from '../components/ChatSheet';

interface Props {
  route: { params?: { question?: string } };
}

export default function VoiceChatScreen({ route }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const question = route.params?.question ?? '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <ChatSheet
        fullScreen
        onClose={() => navigation.goBack()}
        initialQuestion={question}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
