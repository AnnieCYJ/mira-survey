import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import OrbDots from '../components/OrbDots';
import Icon from '../components/Icon';
import { QUESTIONS } from '../data/chat';
import { RootStackParamList } from '../navigation/RootStackNavigator';

type FocusNavProp = StackNavigationProp<RootStackParamList, 'Chat'>;

export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<FocusNavProp>();

  const openChat = (question?: string) => {
    navigation.navigate('Chat', { initialQuestion: question });
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.head}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Mira AI</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>1.2</Text>
              </View>
            </View>
            <Text style={styles.sub}>你的健康助手</Text>
          </View>

          <OrbDots />

          <View style={styles.questions}>
            {QUESTIONS.map((row, i) => (
              <QuestionRow key={i} row={row} index={i} scrollRight={i % 2 === 0} onPress={openChat} />
            ))}
          </View>
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + theme.space.sm }]}>
          <TouchableOpacity
            style={styles.inputWrap}
            onPress={() => openChat()}
            activeOpacity={0.85}
          >
            <Text style={styles.inputPlaceholder}>问 Mira 任何事</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sendBtn} onPress={() => openChat()} activeOpacity={0.85}>
            <Icon name="send" size={theme.fs(18)} color={theme.colors.textWhite} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(14),
    paddingBottom: theme.space.lg,
  },
  head: { marginBottom: theme.space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  badge: {
    marginLeft: theme.sp(2),
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
  },
  sub: { fontSize: theme.fontSize.sm, color: theme.colors.textWhite70, marginTop: theme.sp(1) },
  questions: { marginTop: theme.space.md },
  marqueeContainer: {
    width: '100%',
    overflow: 'hidden',
    marginBottom: theme.sp(2.5),
  },
  marqueeTrack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    marginRight: theme.sp(2),
    maxWidth: 155,
  },
  qText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(2.5),
    paddingBottom: theme.sp(2.5),
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.35)',
  },
  inputWrap: {
    flex: 1,
    height: theme.sp(12),
    justifyContent: 'center',
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(247,246,252,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    marginRight: theme.sp(2),
  },
  inputPlaceholder: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  sendBtn: {
    width: theme.sp(12),
    height: theme.sp(12),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface QuestionRowProps {
  row: string[];
  index: number;
  scrollRight: boolean;
  onPress: (q: string) => void;
}

const SCREEN_W = Dimensions.get('window').width;
// 估算单个 chip 占位（maxWidth + marginRight）
const CHIP_SLOT = 155 + theme.sp(2);
// 保证一组内容宽度超过屏幕宽度，避免滚动时出现空白
const REPEAT = Math.max(3, Math.ceil(SCREEN_W / CHIP_SLOT) + 1);

function QuestionRow({ row, index, scrollRight, onPress }: QuestionRowProps) {
  const scrollX = useRef(new Animated.Value(0)).current;
  const [groupWidth, setGroupWidth] = useState(0);

  // 一组内容：把原始问题重复 REPEAT 次
  const groupItems = React.useMemo(
    () => Array.from({ length: REPEAT }).flatMap((_, r) => row.map((q, i) => ({ q, key: `${r}-${i}` }))),
    [row]
  );

  useEffect(() => {
    if (groupWidth === 0) return;
    // 向右滚：从 -groupWidth 滚动到 0（新内容从左侧进入）
    // 向左滚：从 0 滚动到 -groupWidth（新内容从右侧进入）
    const from = scrollRight ? -groupWidth : 0;
    const to = scrollRight ? 0 : -groupWidth;
    scrollX.setValue(from);

    const loop = Animated.loop(
      Animated.timing(scrollX, {
        toValue: to,
        duration: 16000 + index * 1800, // 每排速度略有差异，更自然
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const t = setTimeout(() => loop.start(), index * 350);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [groupWidth, scrollRight, index, scrollX]);

  const onTrackLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    // track 里有两组内容，单组宽度为总宽度的一半
    setGroupWidth(e.nativeEvent.layout.width / 2);
  };

  const renderChips = () =>
    groupItems.map(({ q, key }) => (
      <TouchableOpacity key={key} style={styles.qChip} onPress={() => onPress(q)} activeOpacity={0.8}>
        <Text style={styles.qText} numberOfLines={1}>
          {q}
        </Text>
      </TouchableOpacity>
    ));

  return (
    <View style={styles.marqueeContainer}>
      <Animated.View onLayout={onTrackLayout} style={[styles.marqueeTrack, { transform: [{ translateX: scrollX }] }]}>
        {renderChips()}
        {renderChips()}
      </Animated.View>
    </View>
  );
}
