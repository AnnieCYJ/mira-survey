module.exports = {
	configureWebpack: {
		module: {
			rules: [{
				test: /jl_lib/,
				use: [{
					loader: 'script-loader',
					options: {
						// 把 SDK 当作全局脚本执行，自动挂载 exports 到 window
						eval: false
					}
				}]
			}]
		}
	}
}