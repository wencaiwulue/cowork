#!/usr/bin/env python3
"""
LangChain 安装测试脚本

快速验证 LangChain 模块是否可以正常导入和初始化
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))


async def test_imports():
    """测试模块导入"""
    print("🧪 测试模块导入...")

    try:
        from app.services.langchain import LangChainService
        print("  ✓ LangChainService 导入成功")
    except Exception as e:
        print(f"  ✗ LangChainService 导入失败: {e}")
        return False

    try:
        from app.services.langchain.llm import LLMProvider
        print("  ✓ LLMProvider 导入成功")
    except Exception as e:
        print(f"  ✗ LLMProvider 导入失败: {e}")
        return False

    try:
        from app.services.langchain.tools import LangChainToolManager
        print("  ✓ LangChainToolManager 导入成功")
    except Exception as e:
        print(f"  ✗ LangChainToolManager 导入失败: {e}")
        return False

    try:
        from app.services.langchain.skills import SkillOrchestrator
        print("  ✓ SkillOrchestrator 导入成功")
    except Exception as e:
        print(f"  ✗ SkillOrchestrator 导入失败: {e}")
        return False

    try:
        from app.services.langchain.rag import RAGManager
        print("  ✓ RAGManager 导入成功")
    except Exception as e:
        print(f"  ✗ RAGManager 导入失败: {e}")
        return False

    try:
        from app.services.langchain.trace import TraceManager
        print("  ✓ TraceManager 导入成功")
    except Exception as e:
        print(f"  ✗ TraceManager 导入失败: {e}")
        return False

    return True


async def test_basic_init():
    """测试基本初始化（不依赖外部服务）"""
    print("\n🧪 测试基本初始化...")

    try:
        from app.services.langchain import LangChainService

        # 使用最小配置
        config = {
            "llm": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "dummy_key_for_testing",
            },
            "trace": {
                "enabled": False,  # 禁用 Trace 避免额外依赖
            }
        }

        service = LangChainService(config)
        print("  ✓ LangChainService 实例创建成功")

        # 不实际初始化（避免需要 API Key）
        print("  ✓ 基础结构测试通过")

        return True

    except Exception as e:
        print(f"  ✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """主函数"""
    print("=" * 60)
    print("🦜 LangChain 模块测试")
    print("=" * 60)

    # 测试导入
    import_ok = await test_imports()

    if not import_ok:
        print("\n❌ 模块导入测试失败，请检查:")
        print("   1. 是否已安装依赖: pip install -r requirements-langchain.txt")
        print("   2. 是否在正确的目录运行")
        sys.exit(1)

    # 测试基本初始化
    init_ok = await test_basic_init()

    if not init_ok:
        print("\n⚠️ 基本初始化测试失败，但模块可以导入")

    print("\n" + "=" * 60)
    print("✅ 测试完成！")
    print("=" * 60)

    print("\n下一步:")
    print("  1. 安装依赖: pip install -r requirements-langchain.txt")
    print("  2. 设置 OpenAI API Key: export OPENAI_API_KEY=your_key")
    print("  3. 运行完整测试: python init_langchain.py")
    print("  4. 启动服务: python -m uvicorn app.main:app --reload")


if __name__ == "__main__":
    asyncio.run(main())
