// 通用工具函数（自 WeChat Demo 的 utils/util.ts 平移而来）
// 供 ecgTest / ecgRead / waveform / pttTest 等页面使用

// 监听蓝牙返回数据转十六进制
export const ab2hex = function (bufferData) {
  const hexArr = Array.prototype.map.call(
    new Uint8Array(bufferData),
    function (bit) {
      return ('00' + bit.toString(16)).slice(-2)
    }
  )
  return hexArr;
}

// MAC 地址末段 +1（大写返回）
export const incrementMacAddress = function (macAddress) {
  let macArray = macAddress.split(':');
  let lastGroup = parseInt(macArray[5], 16);
  lastGroup++;
  macArray[5] = lastGroup.toString(16).padStart(2, '0').toUpperCase();
  return macArray.join(':').toUpperCase();
}

// 时间格式化 yyyy/MM/dd HH:mm:ss
const formatNumber = (n) => {
  const s = n.toString()
  return s[1] ? s : '0' + s
}
export const formatTime = (date) => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()
  return (
    [year, month, day].map(formatNumber).join('/') +
    ' ' +
    [hour, minute, second].map(formatNumber).join(':')
  )
}
