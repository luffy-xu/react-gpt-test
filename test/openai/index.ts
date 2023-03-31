import {
  Configuration,
  CreateCompletionRequest,
  OpenAIApi,
  CreateChatCompletionRequest,
} from 'openai';
import { completionParams, userOptions } from '../constant';
import { generatePrompt } from '../prompt';
import { HuskyGPTTypeEnum, IReadFileResult } from '../types';
import { replaceCodeBlock } from '../utils';
import TypingSpinner from '../text-typing';
import ora from 'ora';
import { PERFECT_KEYWORDS } from '../prompt/constant';

/**
 * OpenAI Factory
 * Usage:
 * const openai = new OpenAIFactory();
 * const result = await openai.run({ filePath });
 */
class OpenAIFactory {
  private configuration: Configuration;
  private openai: OpenAIApi;
  private typingSpinner: TypingSpinner;

  constructor() {
    // Create a new OpenAI API client configuration
    this.configuration = new Configuration({
      apiKey: userOptions.openAIKey.trim(),
    });

    // Create a new OpenAI API client
    this.openai = new OpenAIApi(this.configuration);

    // Create a new typing spinner
    this.typingSpinner = new TypingSpinner();
  }

  private openAICompletionMap: Record<
    HuskyGPTTypeEnum,
    (prompt: string) => Promise<string>
  > = {
    [HuskyGPTTypeEnum.Test]: this.openAICreateCompletion.bind(this),
    [HuskyGPTTypeEnum.Review]: this.openAIChatCompletion.bind(this),
  };

  private get completionParams(): CreateCompletionRequest {
    const options: CreateCompletionRequest = {
      ...completionParams,
      ...userOptions.openAIOptions,
    };

    return options;
  }

  private get chatCompletionParams(): CreateChatCompletionRequest {
    const completionParams = this.completionParams;
    const options: CreateChatCompletionRequest = {
      model: completionParams.model,
      messages: [],
      temperature: completionParams.temperature,
      max_tokens: completionParams.max_tokens!,
      top_p: completionParams.top_p,
      stop: completionParams.stop as string[],
      frequency_penalty: completionParams.frequency_penalty,
      presence_penalty: completionParams.presence_penalty,
    };

    return options;
  }

  /**
   * Generate prompt for the OpenAI API
   */
  private generatePrompt(fileResult: IReadFileResult): string[] {
    // Set the file content as the prompt for the API request
    const prompt = generatePrompt(fileResult);

    return prompt;
  }

  /**
   * Generate a test message using the OpenAI API
   */
  private async openAICreateCompletion(prompt: string): Promise<string> {
    // Create a new chat completion, using the GPT-3.5 Turbo model
    const completion = await this.openai.createCompletion({
      ...this.completionParams,
      prompt,
    });

    // Print the message generated by the API
    const result = completion.data.choices[0].text;

    if (process.env.DEBUG) {
      console.log('createCompletion usage ===>', completion.data.usage);
    }

    return result || '';
  }

  /**
   * Generate a review message using the OpenAI API chat completion
   */
  private async openAIChatCompletion(prompt: string): Promise<string> {
    // Create a new chat completion, using the GPT-3.5 Turbo model
    const completion = await this.openai.createChatCompletion({
      ...this.chatCompletionParams,
      messages: [{ role: 'user', content: prompt }],
    });

    if (process.env.DEBUG) {
      console.log('createChatCompletion usage ===>', completion.data.usage);
    }

    // Print the message generated by the API
    const result = completion.data.choices[0].message?.content;

    return result || '';
  }

  /**
   * Typing the result message with spinner
   */
  private async typingResultMessage(messages: string[]): Promise<void> {
    if (userOptions.options.reviewTyping === 'false') return;

    const typingMessageArray = messages.map((message) =>
      replaceCodeBlock(message)
    );

    for (const typingMessage of typingMessageArray) {
      await this.typingSpinner.run(
        typingMessage,
        typingMessage.split(' ').includes(PERFECT_KEYWORDS) ? 'succeed' : 'fail'
      );
    }
  }

  /**
   * Run the OpenAI API
   * @description filePath is the path of the file to be passed to the OpenAI API as the prompt
   * @returns {Promise<string>}
   */
  async run(fileResult: IReadFileResult): Promise<string> {
    const promptArray = this.generatePrompt(fileResult);

    // Create completion request for each prompt
    const messagePromises = promptArray.map(async (prompt) => {
      if (process.env.DEBUG) {
        console.log('prompt ===>', prompt);
      }

      const message = await this.openAICompletionMap[userOptions.huskyGPTType](
        prompt
      );
      return message;
    });

    // Start review
    const reviewSpinner = ora('[huskygpt] Start review your code: \n').start();

    try {
      const messageArray = await Promise.all(messagePromises);
      reviewSpinner.succeed(
        '[huskygpt] Review your code successfully as follow: '
      );

      // Typing the result message
      await this.typingResultMessage(messageArray);

      return messageArray.join('\n\n---\n\n');
    } catch (error) {
      console.error('run error:', error);
      reviewSpinner.fail('[huskygpt] Review your code failed!\n');
      return '[huskygpt] Call OpenAI API failed!';
    }
  }
}

export default OpenAIFactory;
