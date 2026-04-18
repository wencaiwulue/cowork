#!/usr/bin/env python3
"""
LangChain 服务初始化脚本

用法:
    python init_langchain.py [--check-only]
"""

import asyncio
import sys
import os
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from app.services.langchain import LangChainService


async def check_installation():
    """检查 LangChain 依赖是否已安装"""
    print("🔍 检查 LangChain 依赖...")

    try:
        import langchain
        print(f"  ✓ langchain 已安装 (版本: {langchain.__version__})")
    except ImportError:
        print("  ✗ langchain 未安装")
        return False

    try:
        import langchain_core
        print(f"  ✓ langchain-core 已安装")
    except ImportError:
        print("  ✗ langchain-core 未安装")
        return False

    try:
        import langchain_openai
        print(f"  ✓ langchain-openai 已安装")
    except ImportError:
        print("  ⚠ langchain-openai 未安装 (OpenAI 功能不可用)")

    try:
        import langchain_ollama
        print(f"  ✓ langchain-ollama 已安装")
    except ImportError:
        print("  ⚠ langchain-ollama 未安装 (Ollama 功能不可用)")

    return True


async def initialize_service():
    """初始化 LangChain 服务"""
    print("\n🚀 初始化 LangChain 服务...")

    config = {
        "llm": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "temperature": 0.7,
        },
        "trace": {
            "enabled": True,
            "local_storage": {
                "enabled": True,
                "retention_days": 30,
            },
            "langsmith": {
                "enabled": False,
            },
            "langfuse": {
                "enabled": False,
            },
        }
    }

    service = LangChainService(config)

    try:
        await service.initialize()
        print("  ✓ LangChain 服务初始化成功")

        # 健康检查
        health = await service.health_check()
        print(f"\n📊 健康检查:")
        print(f"  - 初始化状态: {health['initialized']}")
        print(f"  - LLM Provider: {health['llm_provider']}")
        print(f"  - Tools: {health['tool_manager']} 个")
        print(f"  - Skills: {health['skill_orchestrator']} 个")
        print(f"  - RAG Configs: {health['rag_manager']} 个")

        return service

    except Exception as e:
        print(f"  ✗ 初始化失败: {e}")
        raise


async def test_tools(service: LangChainService):
    """测试 Tools 功能"""
    print("\n🔧 测试 Tools 功能...")

    # 列出 Tools
    tools = service.tool_manager.list_tools()
    print(f"  可用 Tools ({len(tools)} 个):")
    for tool in tools[:5]:  # 只显示前5个
        print(f"    - {tool['name']}: {tool['description'][:50]}...")

    # 尝试执行一个简单的 Tool（如 DuckDuckGo 搜索）
    try:
        print("\n  测试 DuckDuckGo 搜索...")
        result = await service.tool_manager.invoke(
            tool_name="duckduckgo",
            input_data={"query": "LangChain Python"}
        )
        print(f"    ✓ 搜索成功: {str(result)[:100]}...")
    except Exception as e:
        print(f"    ⚠ 搜索失败: {e}")


async def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="LangChain 服务初始化")
    parser.add_argument("--check-only", action="store_true", help="仅检查依赖")
    parser.add_argument("--test", action="store_true", help="运行测试")
    args = parser.parse_args()

    print("=" * 60)
    print("🦜 LangChain 服务初始化工具")
    print("=" * 60)

    # 检查依赖
    deps_ok = await check_installation()

    if args.check_only:
        sys.exit(0 if deps_ok else 1)

    if not deps_ok:
        print("\n⚠️ 依赖未完全安装，请先安装依赖:")
        print("   pip install -r requirements-langchain.txt")
        sys.exit(1)

    # 初始化服务
    try:
        service = await initialize_service()

        if args.test:
            await test_tools(service)

        print("\n" + "=" * 60)
        print("✅ LangChain 服务初始化完成！")
        print("=" * 60)

    except Exception as e:
        print(f"\n❌ 初始化失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
