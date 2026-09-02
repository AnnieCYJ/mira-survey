import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * 全局错误边界：捕获任何渲染期 JS 异常，显示可读提示而非白屏/硬退出。
 * 注意：它无法捕获原生层崩溃（EXC_BAD_ACCESS 等由 SDK 触发的进程退出），
 * 那种情况需要看 Xcode 控制台 / 设备崩溃日志。
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  private reload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.box}>
          <Text style={styles.title}>页面出错了</Text>
          <Text style={styles.msg}>{this.state.error.message || '未知渲染错误'}</Text>
          <TouchableOpacity style={styles.btn} onPress={this.reload}>
            <Text style={styles.btnText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: theme.colors.bgTop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
    gap: theme.space.md,
  },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: theme.colors.textWhite },
  msg: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
  btn: {
    marginTop: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
  },
  btnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.accentSolid },
});
