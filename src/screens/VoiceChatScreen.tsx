import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import ChatSheet from '../components/ChatSheet';
import { theme } from '../theme/theme';

interface Props {
  route: { params?: { question?: string } };
}

export default function VoiceChatScreen({ route }: Props) {
  const navigation = useNavigation();
  const question = route.params?.question ?? '';

  return (
    // v18.30：顶部紫色头（含状态栏延伸）——底色给渐变头部同款深紫，状态栏白字
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ChatSheet
        fullScreen
        onClose={() => navigation.goBack()}
        initialQuestion={question}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.gradCardFrom },
});
